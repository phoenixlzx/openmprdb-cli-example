#!/usr/bin/node
'use strict';

const config = require('./config');

const argv = require('process').argv.slice(2);
const fs = require('fs/promises');
const https = require('https');
const openpgp = require('openpgp');
const { v4: uuidv4 } = require('uuid');

function api(options, data) {
    return new Promise(function(resolve, reject) {
        const req = https.request(options, function(res) {
            let resbody = '';
            res.on('data', function(chunk) {
                resbody += chunk;
            });
            res.on('end', function() {
                resolve(resbody);
            });
        });
        req.on('error', function(err) {
            reject(err);
        });
        if (data) {
            req.write(data);
        }
        req.end();
    });
}

function syncWait(data, submits) {
    return new Promise(function(resolve) {
        setTimeout(function() {
            resolve(finalizeSubmits(data, submits));
        }, config.wait);
    });
}

function timestamp() {
    return Math.floor(new Date().getTime() / 1000);
}

function obj2kv(obj) {
    let kv = '';
    for (let k in obj) {
        kv += `${k}: ${obj[k]}\n`
    }
    return kv;
}

async function generateKeyECC() {
    const { privateKey, publicKey, revocationCertificate } = await openpgp.generateKey({
        type: 'ecc',
        curve: 'curve25519',
        userIDs: config.userIDs,
        passphrase: config.passphrase,
        format: 'armored'
    });
    return saveKey(privateKey, publicKey, revocationCertificate);
}

async function generateKeyRSA() {
    const { privateKey, publicKey } = await openpgp.generateKey({
        type: 'rsa',
        rsaBits: 4096,
        userIDs: config.userIDs,
        passphrase: config.passphrase
    });
    return saveKey(privateKey, publicKey);
}

async function saveKey(privateKey, publicKey, revocationCertificate) {
    await fs.writeFile('privateKey', privateKey, {'encoding':'utf8'});
    await fs.writeFile('publicKey', publicKey, {'encoding':'utf8'});
    if (revocationCertificate) {
        await fs.writeFile('revocationCertificate', revocationCertificate, {'encoding':'utf8'});
    }
}

async function register() {
    const signedClearTextMessage = await pgpSignMessage(`server_name: ${config.serverName}`);
    const publicKey = await fs.readFile('publicKey', 'utf8');
    await apiRegister(JSON.stringify({
        message: signedClearTextMessage,
        public_key: publicKey
    }));
}

async function sync() {
    const banlist = await getBanlist();
    const submits = await getSubmits();
    const list = await prepareList(banlist, submits);
    for (let i = 0; i < list.length; i++) {
        const ban = list[i];
        let data = {
            uuid: uuidv4(),
            timestamp: new Date(ban.created).getTime() / 1000,
            player_uuid: ban.uuid,
            points: -1,
            comment: ban.reason
        };
        await syncWait(data, submits);
    }
}

async function manual(uuid, points, comment) {
    let data = obj2kv({
        uuid: uuidv4(),
        timestamp: timestamp(),
        player_uuid: uuid,
        points: points,
        comment: comment
    });
    await apiPutSubmit(await pgpSignMessage(data));
}

async function revoke(submit_uuid, comment) {
    const signedClearTextMessage = await pgpSignMessage(`timestamp: ${timestamp()}\ncomment: ${comment}`);
    await apiRevokeSubmit(submit_uuid, signedClearTextMessage);
}

async function prepareList(banlist, submits) {
    let list = [];
    banlist.forEach(function (ban) {
        if (!submits[`${ban.uuid}:${new Date(ban.created).getTime() / 1000}`]) {
            list.push(ban);
        }
    });
    return(list);
}

async function getBanlist() {
    return JSON.parse(await fs.readFile('banned-players.json', 'utf8'));
}

async function getSubmits() {
    return JSON.parse(await fs.readFile('submits.json', 'utf8'));
}

async function finalizeSubmits(data, submits) {
    const submitText = obj2kv(data);
    let signedClearTextMessage = await pgpSignMessage(submitText);
    const res = JSON.parse(await apiPutSubmit(signedClearTextMessage));
    if (res.status) {
        data['submit_id'] = res.uuid;
        await updateSubmits(data, submits);
    }
}

async function updateSubmits(data, submits) {
    submits[`${data.player_uuid}:${data.timestamp}`] = {
        local: data.uuid,
        remote: data.submit_id
    };
    await fs.writeFile('submits.json', JSON.stringify(submits), {'encoding': 'utf8'});
}

async function apiRegister(data) {
    const options = {
        hostname: config.endpoint,
        port: 443,
        path: '/v1/server/register',
        method: 'PUT',
        headers: {
            'Content-Type': 'application/json'
        }
    };
    const res = JSON.parse(await api(options, data));
    if (res.status) {
        await fs.writeFile('server_uuid', res.uuid, {'encoding': 'utf8'});
    }
}

async function apiPutSubmit(data) {
    const options = {
        hostname: config.endpoint,
        port: 443,
        path: '/v1/submit/new',
        method: 'PUT',
        headers: {
            'Content-type': 'text/plain'
        }
    };
    return await api(options, data);
}

async function apiRevokeSubmit(submit_uuid, data) {
    const options = {
        hostname: config.endpoint,
        port: 443,
        path: `/v1/submit/uuid/${submit_uuid}`,
        method: 'DELETE',
        headers: {
            'Content-type': 'text/plain',
            'Content-Length': Buffer.byteLength(data) // Content-Length is needed for body in DELETE
        }
    };
    return await api(options, data);
}

async function pgpSignMessage(message) {
    const publicKeyArmored = await fs.readFile('publicKey', 'utf8');
    const privateKeyArmored = await fs.readFile('privateKey', 'utf8');
    const passphrase = config.passphrase;
    const publicKey = await openpgp.readKey({ armoredKey: publicKeyArmored });
    const privateKey = await openpgp.decryptKey({
        privateKey: await openpgp.readPrivateKey({ armoredKey: privateKeyArmored }),
        passphrase
    });
    
    const unsignedMessage = await openpgp.createCleartextMessage({ text: message });
    const cleartextMessage = await openpgp.sign({
        message: unsignedMessage,
        signingKeys: privateKey
    });
    return(cleartextMessage);
}

switch (argv[0]) {
    case 'init': {
        if (argv[1] === 'ecc') {
            generateKeyECC();
        } else {
            generateKeyRSA();
        }
        break;
    }
    case 'reg':
    case 'register': {
        register();
        break;
    }
    case 'sync': {
        sync();
        break;
    }
    case 'manual': {
        // TODO verify input
        let uuid = argv[1];
        let points = argv[2];
        let comment = '';
        for (let i = 3; i < argv.length; i++) {
            comment += `${argv[i]} `;
        }
        manual(uuid, points, comment);
        break;
    }
    case 'revoke': {
        let submit_uuid = argv[1];
        let comment = '';
        for (let i = 2; i < argv.length; i++) {
            comment += `${argv[i]} `;
        }
        revoke(submit_uuid, comment);
        break;
    }
    default:
        console.log('TBD');
}
