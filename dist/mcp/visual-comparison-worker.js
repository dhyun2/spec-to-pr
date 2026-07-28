#!/usr/bin/env node
import { createRequire as __createRequire } from "node:module";
import { fileURLToPath as __fileURLToPath } from "node:url";
import { dirname as __dirnameOf } from "node:path";
const require = __createRequire(import.meta.url);
const __filename = __fileURLToPath(import.meta.url);
const __dirname = __dirnameOf(__filename);
import{L as s,M as t}from"./chunk-J4BM3BLJ.js";import"./chunk-LU275QGC.js";import"./chunk-XVIUDV4H.js";import"./chunk-MO2PBA3T.js";import{parentPort as i}from"worker_threads";i!==null&&i.on("message",a=>{p(a)});async function p(a){try{let o={masks:a.masks,...a.pixelTolerance===void 0?{}:{pixelTolerance:a.pixelTolerance}},r=a.baseline.kind==="rgba"&&a.actual.kind==="rgba"?await t({baseline:{data:Buffer.from(a.baseline.data),width:a.baseline.width,height:a.baseline.height},actual:{data:Buffer.from(a.actual.data),width:a.actual.width,height:a.actual.height},...o}):a.baseline.kind==="png"&&a.actual.kind==="png"?await s({baseline:Buffer.from(a.baseline.data),actual:Buffer.from(a.actual.data),...o}):(()=>{throw new Error("VISUAL_COMPARISON_WORKER_PROTOCOL: image encodings must match")})(),e=Uint8Array.from(r.diff),n=Uint8Array.from(r.overlay),l={jobId:a.jobId,ok:!0,comparison:{...r,diff:e,overlay:n}};i?.postMessage(l,[e.buffer,n.buffer])}catch(o){let r={jobId:a.jobId,ok:!1,error:o instanceof Error?o.message:"unknown visual comparison error"};i?.postMessage(r)}}
