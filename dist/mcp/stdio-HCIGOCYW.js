#!/usr/bin/env node
import { createRequire as __createRequire } from "node:module";
import { fileURLToPath as __fileURLToPath } from "node:url";
import { dirname as __dirnameOf } from "node:path";
const require = __createRequire(import.meta.url);
const __filename = __fileURLToPath(import.meta.url);
const __dirname = __dirnameOf(__filename);
import{j as a}from"./chunk-M7FHN3PO.js";import"./chunk-XVIUDV4H.js";import"./chunk-MO2PBA3T.js";import o from"process";var i=class{append(t){this._buffer=this._buffer?Buffer.concat([this._buffer,t]):t}readMessage(){if(!this._buffer)return null;let t=this._buffer.indexOf(`
`);if(t===-1)return null;let e=this._buffer.toString("utf8",0,t).replace(/\r$/,"");return this._buffer=this._buffer.subarray(t+1),h(e)}clear(){this._buffer=void 0}};function h(s){return a.parse(JSON.parse(s))}function n(s){return JSON.stringify(s)+`
`}var f=class{constructor(t=o.stdin,e=o.stdout){this._stdin=t,this._stdout=e,this._readBuffer=new i,this._started=!1,this._ondata=r=>{this._readBuffer.append(r),this.processReadBuffer()},this._onerror=r=>{this.onerror?.(r)}}async start(){if(this._started)throw new Error("StdioServerTransport already started! If using Server class, note that connect() calls start() automatically.");this._started=!0,this._stdin.on("data",this._ondata),this._stdin.on("error",this._onerror)}processReadBuffer(){for(;;)try{let t=this._readBuffer.readMessage();if(t===null)break;this.onmessage?.(t)}catch(t){this.onerror?.(t)}}async close(){this._stdin.off("data",this._ondata),this._stdin.off("error",this._onerror),this._stdin.listenerCount("data")===0&&this._stdin.pause(),this._readBuffer.clear(),this.onclose?.()}send(t){return new Promise(e=>{let r=n(t);this._stdout.write(r)?e():this._stdout.once("drain",e)})}};export{f as StdioServerTransport};
