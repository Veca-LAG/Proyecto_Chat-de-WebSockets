'use strict';

const http = require('http');
const fs   = require('fs');
const path = require('path');
const { PUBLIC_DIR } = require('./config');

function getContentType(filePath) {
    const extension = path.extname(filePath).toLowerCase();
    const types = {
        '.html':  'text/html; charset=utf-8',
        '.css':   'text/css; charset=utf-8',
        '.js':    'application/javascript; charset=utf-8',
        '.json':  'application/json; charset=utf-8',
        '.mp3':   'audio/mpeg',
        '.png':   'image/png',
        '.jpg':   'image/jpeg',
        '.jpeg':  'image/jpeg',
        '.webp':  'image/webp',
        '.svg':   'image/svg+xml; charset=utf-8',
        '.ico':   'image/x-icon'
    };
    return types[extension] || 'application/octet-stream';
}

function handleHttpRequest(req, res) {
    const requestedPath = req.url.split('?')[0] === '/' ? '/index.html' : req.url.split('?')[0];
    const safePath = path.normalize(decodeURIComponent(requestedPath)).replace(/^([.][.][/\\])+/, '');
    const filePath = path.join(PUBLIC_DIR, safePath);

    if (!filePath.startsWith(PUBLIC_DIR)) {
        res.writeHead(403);
        res.end('Acceso denegado');
        return;
    }

    fs.readFile(filePath, (error, content) => {
        if (error) {
            res.writeHead(404);
            res.end('Archivo no encontrado');
            return;
        }
        res.writeHead(200, { 'Content-Type': getContentType(filePath) });
        res.end(content, 'utf-8');
    });
}

const server = http.createServer(handleHttpRequest);

module.exports = { server };
