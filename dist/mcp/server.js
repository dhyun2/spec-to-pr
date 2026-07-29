#!/usr/bin/env node
import { createRequire as __createRequire } from "node:module";
import { fileURLToPath as __fileURLToPath } from "node:url";
import { dirname as __dirnameOf } from "node:path";
const require = __createRequire(import.meta.url);
const __filename = __fileURLToPath(import.meta.url);
const __dirname = __dirnameOf(__filename);
import{a as r}from"./chunk-CP76NC6M.js";import"./chunk-LU275QGC.js";import{E as s}from"./chunk-XVIUDV4H.js";import"./chunk-MO2PBA3T.js";var a="spec-to-pr-kernel",t=22,u=s.string();async function p(){m();let[{StdioServerTransport:o},{createKernelServer:e},{createLazyServicesProvider:n}]=await Promise.all([import("./stdio-HCIGOCYW.js"),import("./create-server-MOLVQ2S5.js"),import("./run-service-provider-G5DVVGFM.js")]),i=e(n()),c=new o;await i.connect(c),console.error(`[spec-to-pr] ${a} ${r.version} connected over stdio`)}function m(){let o=Number.parseInt(process.versions.node.split(".")[0]??"0",10);if(!Number.isFinite(o)||o<t)throw new Error(`spec-to-pr requires Node ${t}+; current version is ${process.versions.node}`)}p().catch(o=>{let e=o instanceof Error?o.stack??o.message:String(o);console.error(`[spec-to-pr] fatal: ${e}`),process.exitCode=1});
