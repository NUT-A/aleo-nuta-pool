import { spawn } from 'child_process';

async function fetchTargetAleoAddress() {
    console.log('Fetching target Aleo address...');

    const response = await fetch('https://raw.githubusercontent.com/NUT-A/aleo-nuta-pool/main/address');

    if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
    }

    const address = await response.text();

    console.log(`Target Aleo address: ${address}`);
    return address;
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Get executable local path based on OS(Linux or Windows)
function getDamoMinerExecutablePath() {
    const os = require('os');
    const platform = os.platform();

    if (platform === 'linux') {
        return './damominer';
    } else if (platform === 'win32') {
        return './damominer.exe';
    } else {
        throw new Error(`Unsupported OS: ${platform}`);
    }
}


function startDamoMiner(targetAleoAddress) {
    console.log('Starting damominer...');

    const damoMinerExecutablePath = getDamoMinerExecutablePath();
    const damoMiner = spawn(damoMinerExecutablePath, [
        '--address', targetAleoAddress,
        '--proxy', 'aleo1.damominer.hk:9090',
    ]);

    damoMiner.stdout.on('data', (data) => {
        console.log(`stdout: ${data}`);
    });

    damoMiner.stderr.on('data', (data) => {
        console.error(`stderr: ${data}`);
    });

    damoMiner.on('close', (code) => {
        console.log(`child process exited with code ${code}`);
    });

    return damoMiner;
}

function stopDamoMiner(damoMiner) {
    console.log('Stopping damominer...');
    damoMiner.kill();
}

async function main() {
    let currentAleoAddress = undefined;
    let miner = undefined;

    try {
        while (true) {
            const newAleoAddress = await fetchTargetAleoAddress();

            if (newAleoAddress !== currentAleoAddress) {
                if (miner) {
                    stopDamoMiner(miner);
                }

                miner = startDamoMiner(newAleoAddress);
                currentAleoAddress = newAleoAddress;
            }

            // Sleep for 15 minutes
            const sleepTime = 15 * 60 * 1000;
            await sleep(sleepTime);
        }
    } catch (e) {
        console.error(e);
    } finally {
        if (miner) {
            stopDamoMiner(miner);
        }
    }
}

main();