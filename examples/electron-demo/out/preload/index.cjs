"use strict";
const electron = require("electron");
const CHANNEL = {
  /** SELECT-style: returns rows. */
  run: "minnaldb:run",
  /** SELECT first: returns one row or null. */
  first: "minnaldb:first",
  /** Write: returns {changes, lastInsertRowid}. */
  exec: "minnaldb:exec",
  /** Subscribe: returns {subId, initial}. */
  subscribe: "minnaldb:subscribe",
  /** Tear down a subscription. */
  unsubscribe: "minnaldb:unsubscribe",
  /** Push: main → renderer when a sub re-evaluates. */
  update: "minnaldb:update"
};
function exposeMinnaldbBridge() {
  const bridge = {
    run: (req) => electron.ipcRenderer.invoke(CHANNEL.run, req),
    first: (req) => electron.ipcRenderer.invoke(CHANNEL.first, req),
    exec: (req) => electron.ipcRenderer.invoke(CHANNEL.exec, req),
    subscribe: (req) => electron.ipcRenderer.invoke(CHANNEL.subscribe, req),
    unsubscribe: (subId) => electron.ipcRenderer.invoke(CHANNEL.unsubscribe, subId),
    onUpdate: (listener) => {
      const wrapped = (_e, payload) => listener(payload);
      electron.ipcRenderer.on(CHANNEL.update, wrapped);
      return () => {
        electron.ipcRenderer.removeListener(CHANNEL.update, wrapped);
      };
    }
  };
  electron.contextBridge.exposeInMainWorld("minnaldb", bridge);
}
exposeMinnaldbBridge();
