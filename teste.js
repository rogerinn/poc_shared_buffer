import { Worker, isMainThread, workerData, parentPort } from 'worker_threads';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

if (isMainThread) {
    const numWorkers = 4;
    const bufferSize = 4 * (2 + numWorkers); // Semáforo, índices da fila e fila de IDs
    const sharedBuffer = new SharedArrayBuffer(bufferSize);
    const sharedArray = new Int32Array(sharedBuffer);

    sharedArray[0] = 1; // Semáforo: 1 recurso disponível
    sharedArray[1] = 0; // Índice da cabeça da fila
    sharedArray[2] = 0; // Índice da cauda da fila

    // Inicializa a fila com IDs dos workers
    for (let i = 3; i < 3 + numWorkers; i++) {
        sharedArray[i] = 0;
    }

    const workers = [];
    for (let i = 1; i <= numWorkers; i++) {
        workers.push(new Worker(__filename, { workerData: { id: i, buffer: sharedBuffer, numWorkers } }));
    }

    for (const worker of workers) {
        worker.on('message', (message) => {
            console.log(message);
        });

        worker.on('exit', (code) => {
            if (code !== 0) {
                console.error(`Worker finalizado com código de saída ${code}`);
            }
        });
    }

    // Inicia todos os workers
    for (const worker of workers) {
        worker.postMessage('start');
    }

} else {
    const { id, buffer, numWorkers } = workerData;
    const sharedArray = new Int32Array(buffer);
    const queueStartIndex = 3; // Início da fila no buffer compartilhado

    function wait() {
        const queueTailIndex = Atomics.add(sharedArray, 2, 1); // Incrementa a cauda da fila
        const myQueueIndex = queueStartIndex + (queueTailIndex % numWorkers); // Calcula a posição correta na fila
        Atomics.store(sharedArray, myQueueIndex, id); // Armazena o ID na fila
        console.log(`Worker ${id} entrou na fila na posição ${queueTailIndex + 1}`);

        while (true) {
            const headIndex = Atomics.load(sharedArray, 1);
            const headValue = Atomics.load(sharedArray, queueStartIndex + (headIndex % numWorkers));
            console.log(`Worker ${id} está esperando. Cabeça da fila: ${headIndex}, Valor da cabeça: ${headValue}`);

            if (headValue === id) {
                // Remove o ID da fila e atualiza a cabeça da fila
                Atomics.store(sharedArray, queueStartIndex + (headIndex % numWorkers), 0);
                Atomics.store(sharedArray, 1, (headIndex + 1) % numWorkers); // Atualiza o índice da cabeça da fila
                console.log(`Worker ${id} passou a vez e está liberado`);
                break;
            }

            Atomics.wait(sharedArray, 1, headIndex); // Espera até ser a vez do worker
        }
    }

    function post() {
        Atomics.notify(sharedArray, 1, 1); // Notifica um worker para continuar
        console.log(`Worker ${id} notificou que o semáforo está liberado.`);
    }

    parentPort.once('message', () => {
        const resourceAvailable = Atomics.load(sharedArray, 0) > 0;
        const queueSize = Atomics.load(sharedArray, 2) - Atomics.load(sharedArray, 1);

        if (resourceAvailable && queueSize === 0) {
            // Adquire o recurso diretamente se não houver ninguém na fila
            Atomics.store(sharedArray, 0, Atomics.load(sharedArray, 0) - 1);
            console.log(`Worker ${id} adquiriu o recurso diretamente e está processando.`);
            // Processa e depois libera o recurso
            Atomics.store(sharedArray, 0, Atomics.load(sharedArray, 0) + 1);

            // Notifique o próximo worker na fila
            post(); // Notifica um worker
            parentPort.postMessage(`Worker ${id} processou diretamente.`);
        } else {
            // Se não há recurso disponível ou há workers na fila, entra na fila
            console.log(`Worker ${id} não conseguiu adquirir o recurso diretamente e está entrando na fila.`);
            wait(); // Espera na fila e processa
            parentPort.postMessage(`Worker ${id} processando a fila.`);
        }
    });
}
