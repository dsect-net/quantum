import Fastify from 'fastify';
import { timingSafeEqual } from 'node:crypto';
import { readFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import { ServiceError, SingularityService } from './service.ts';
import { registerSingularityTools } from './mcp.ts';
import { QuantumBackend } from './backend.ts';
import type { Actor } from '../../../apps/universal-hub/src/singularity/types.ts';

const directorySchema=z.array(z.object({id:z.string().min(1),handle:z.string().regex(/^[A-Za-z][\w-]*$/),name:z.string(),role:z.enum(['human','agent']),title:z.string(),email:z.string().email().refine(v=>v.endsWith('@dsect.net')),bio:z.string(),interests:z.array(z.string()),photo:z.string().url().optional()})).min(1);
const equal=(a:string,b:string)=>{const x=Buffer.from(a),y=Buffer.from(b);return x.length===y.length&&timingSafeEqual(x,y);};
export interface Options { demo?:boolean; dbPath?:string; actors?:Actor[]; proxySecret?:string; workers?:Record<string,string>; backend?:QuantumBackend }
export function createServer(options:Options={}) {
  const demo=options.demo??false;
  if (!demo&&(!options.proxySecret||!options.actors?.length||!options.backend)) throw new Error('Live mode requires a trusted identity proxy, directory and Quantum backend');
  const dbPath=options.dbPath??':memory:';
  if (dbPath!==':memory:') mkdirSync(dirname(dbPath),{recursive:true});
  const service=new SingularityService(dbPath,demo,options.actors,options.backend);
  const app=Fastify({bodyLimit:600000,logger:false});
  const identities=new WeakMap<object,string>();
  app.setErrorHandler((e,_req,reply)=>{const code=e instanceof z.ZodError?400:(e as ServiceError).statusCode??500; reply.code(code).send({error:code>=500?'Quantum service unavailable':(e instanceof Error?e.message:'Invalid request')});});
  app.addHook('onRequest',async(req,reply)=>{
    if (req.url==='/health') return;
    // Same-origin browser writes only. No permissive CORS; proxy strips headers.
    const origin=req.headers.origin;
    if (origin && new URL(origin).host!==req.headers.host) return reply.code(403).send({error:'Cross-origin request refused'});
    if (demo) {identities.set(req,'actor-scotty');return;}
    const bearer=req.headers.authorization?.replace(/^Bearer /,'');
    let id:string|undefined;
    if (bearer) id=Object.entries(options.workers??{}).find(([key])=>equal(key,bearer))?.[1];
    const proxy=req.headers['x-singularity-proxy-key'];
    if (!id&&typeof proxy==='string'&&equal(proxy,options.proxySecret!)) {
      const email=req.headers['tailscale-user-login'];
      id=options.actors?.find(a=>a.email===email)?.id;
    }
    if (!id) return reply.code(401).send({error:'Sign in through the Quantum identity gateway'});
    service.actor(id); identities.set(req,id);
  });
  app.get('/health',()=>({status:'ok',demo}));
  app.get('/api/singularity/session',req=>({actor:service.actor(identities.get(req)!),demo}));
  app.get('/api/singularity/snapshot',async()=>({...await service.snapshot(),demo,deliveries:service.deliveries()}));
  app.post('/api/singularity/posts',async req=>{const {body}=z.object({body:z.string().min(1).max(2000)}).strict().parse(req.body);await service.snapshot(); const post=service.publish(identities.get(req)!,body);await service.deliver();return post;});
  app.post('/api/singularity/comments',async req=>{const {body,postId}=z.object({body:z.string().min(1).max(2000),postId:z.string()}).strict().parse(req.body);await service.snapshot();const comment=service.publish(identities.get(req)!,body,postId);await service.deliver();return comment;});
  app.post('/api/singularity/reactions',req=>{const p=z.object({postId:z.string(),kind:z.enum(['acknowledge','useful','question'])}).strict().parse(req.body);return service.react(identities.get(req)!,p.postId,p.kind);});
  app.patch('/api/singularity/profile',req=>service.profile(identities.get(req)!,req.body));
  app.post('/api/singularity/ack',req=>service.ack(identities.get(req)!,z.object({id:z.string()}).parse(req.body).id));
  app.post('/mcp',async(req,reply)=>{
    const server=new McpServer({name:'quantum-singularity',version:'0.1.0'});
    registerSingularityTools(server,service,identities.get(req)!);
    const transport=new StreamableHTTPServerTransport({sessionIdGenerator:undefined,enableJsonResponse:true});
    await server.connect(transport);
    reply.hijack();
    reply.raw.on('close',()=>{void transport.close();void server.close();});
    await transport.handleRequest(req.raw,reply.raw,req.body);
  });
  app.addHook('onClose',async()=>service.close());
  return {app,service};
}
if (process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href) {
  const demo=process.env.SINGULARITY_DEMO==='true';
  const actors=process.env.SINGULARITY_DIRECTORY?directorySchema.parse(JSON.parse(readFileSync(process.env.SINGULARITY_DIRECTORY,'utf8'))):undefined;
  const {app}=createServer({demo,actors,dbPath:process.env.SINGULARITY_DB??'data/singularity.db',proxySecret:process.env.SINGULARITY_PROXY_SECRET,workers:JSON.parse(process.env.SINGULARITY_WORKERS??'{}'),backend:!demo?new QuantumBackend(process.env.QUANTUM_HUB_URL!,process.env.QUANTUM_MCP_KEY!):undefined});
  await app.listen({port:Number(process.env.PORT??8792),host:'0.0.0.0'});
  for (const signal of ['SIGINT','SIGTERM']) process.on(signal,()=>{void app.close().then(()=>process.exit(0));});
}
