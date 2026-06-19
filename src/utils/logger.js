'use strict';

const { SERVER_ID } = require('../config');

function logEvent(event) {
    const time = new Intl.DateTimeFormat('es-MX', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    }).format(new Date());
    console.log(`[${time}] [${SERVER_ID}] ${event}`);
}

module.exports = { logEvent };
