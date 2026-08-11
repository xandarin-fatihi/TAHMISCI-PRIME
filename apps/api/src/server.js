"use strict";

const { app, installGracefulShutdown, prepareRuntime, sanitizeLogLine, shutdownRuntime, startServer, store } = require("./app");

if (require.main === module) {
  startServer()
    .then((server) => installGracefulShutdown(server))
    .catch((error) => {
      console.error("Backend başlatılamadı:", error && error.message ? error.message : "Bilinmeyen hata");
      process.exitCode = 1;
    });
}

module.exports = { app, installGracefulShutdown, prepareRuntime, sanitizeLogLine, shutdownRuntime, startServer, store };
