import { contextBridge } from 'electron';

contextBridge.exposeInMainWorld('desktopApp', {
    platform: process.platform,
});
