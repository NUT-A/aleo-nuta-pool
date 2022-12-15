import { spawn } from 'child_process';
import os from 'os'; 'node-fetch';

async function fetchTargetAleoAddress() {
    console.log('Fetching target Aleo address...');

    const response = await fetch('https://raw.githubusercontent.com/NUT-A/aleo-nuta-pool/main/address');

    if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
    }

    const rawAddress = await response.text();

    // Trim the address
    const address = rawAddress.trim();

    console.log(`Target Aleo address: ${address}`);
    return address;
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Get executable local path based on OS(Linux or Windows)
function getDamoMinerExecutablePath() {
    const platform = os.platform();

    if (platform === 'linux') {
        return './damominer';
    } else if (platform === 'win32') {
        return './damominer.exe';
    } else {
        throw new Error(`Unsupported OS: ${platform}`);
    }
}

function extractHashRateFromLog(text) {
    // Check if text is string
    if (typeof text !== 'string') {
        return undefined;
    }

    // Trim the text
    text = text.trim().toLowerCase();

    // Match regex
    const regex = /.*total:\s*(\d*)/;
    const match = regex.exec(text);

    if (!match) {
        return undefined
    }

    const hashRate = match[1];

    const parsedHashRate = parseInt(hashRate);

    if (isNaN(parsedHashRate)) {
        return undefined;
    }

    return parsedHashRate;
}

const influxApiToken = 'glwP0GQTMVVQ8frFOP1qujDFQEB_OBqmicyDcmScdwzAbXq9VsYIF-6ZBr-7vQo3pfHBLkoge98lOZtSKUsycA==';

function createInfluxLineProtocol(measurement, fields, tags) {
    const tagsString = Object.entries(tags)
        .map(([key, value]) => `${key}=${value}`)
        .join(',');

    const fieldsString = Object.entries(fields)
        .map(([key, value]) => `${key}=${value}`)
        .join(',');

    return `${measurement},${tagsString} ${fieldsString}`;
}

// Report hashrate to influxdb
async function reportHashrateToInlux(hashRate, workerName, address) {
    console.log(`Reporting hashrate: ${hashRate}. Worker: ${workerName}. Address: ${address}`);

    const lineProtocol = createInfluxLineProtocol('hashrate', { value: hashRate }, { worker: workerName, address: address });

    const response = await fetch('https://eu-central-1-1.aws.cloud2.influxdata.com/api/v2/write?org=bac006f07f1d191e&bucket=hashrate', {
        method: 'POST',
        headers: {
            'Authorization': `Token ${influxApiToken}`,
            'Content-Type': 'text/plain',
        },
        body: lineProtocol,
    });

    if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
    }
}

async function reportHashrateToInluxWrapper(hashRate, workerName, address) {
    // Retry 3 times
    for (let i = 0; i < 3; i++) {
        try {
            await reportHashrateToInlux(hashRate, workerName, address);
            return;
        } catch (e) {
            console.error(`Failed to report hashrate to influxdb. Error: ${e} Retrying...`);
        }
    }
}

async function reportHashrate(text, workerName, address) {
    const hashRate = extractHashRateFromLog(text);

    if (hashRate === undefined) {
        return;
    }

    await reportHashrateToInluxWrapper(hashRate, workerName, address);
}

function startDamoMiner(targetAleoAddress, workerName) {
    console.log('Starting damominer...');

    const damoMinerExecutablePath = getDamoMinerExecutablePath();
    const damoMiner = spawn(damoMinerExecutablePath, [
        '--address', targetAleoAddress,
        '--proxy', 'aleo1.damominer.hk:9090',
        '--worker', workerName,
    ]);

    damoMiner.stdout.on('data', async (data) => {
        console.log(`${data}`);

        // Report hashrate
        await reportHashrate(data.toString(), workerName, targetAleoAddress);
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

// Get first argument as worker name
function getWorkerName() {
    const args = process.argv.slice(2);

    if (args.length < 1) {
        throw new Error('Worker name is required');
    }

    return args[0];
}

async function main() {
    const workerName = getWorkerName();

    let currentAleoAddress = undefined;
    let miner = undefined;

    try {
        while (true) {
            const newAleoAddress = await fetchTargetAleoAddress();

            if (newAleoAddress !== currentAleoAddress) {
                if (miner) {
                    stopDamoMiner(miner);
                }

                miner = startDamoMiner(newAleoAddress, workerName);
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