import {describe,it,expect} from 'vitest';
import {createServer} from '../src/fleet/server.js';
import {SingularityService} from '../src/fleet/service.js';
import {seedData,DEMO_POST} from '../../../apps/universal-hub/src/singularity/seed.ts';
import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import {registerSingularityTools} from '../src/fleet/mcp.js';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
describe('shared service',()=>{
 it('persists posts and assignments across restarts, isolates demo/live',()=>{
  const dir=mkdtempSync(join(tmpdir(),'singularity-'));const path=join(dir,'db');
  try {let s=new SingularityService(path,true);s.publish('actor-scotty',DEMO_POST);s.close();s=new SingularityService(path,true);expect(s.read().tasks[0].assigneeId).toBe('actor-iris');expect(s.read().posts[0].tokens.some(t=>t.type==='ref')).toBe(true);s.close();expect(()=>new SingularityService(path,false)).toThrow('separate database');} finally {rmSync(dir,{recursive:true,force:true});}
 });
 it('live effects go through backend and failures remain visible without replay',async()=>{
  let pings=0,assignments=0;
  const s=new SingularityService(':memory:',false,seedData().actors,{refresh:async()=>({}),assign:async()=>{assignments++},ping:async()=>{pings++;throw new Error('timeout')}});
  // Test adapter fixture; production snapshots only read the collab adapter.
  s.db.prepare('UPDATE state SET body=?').run(JSON.stringify(seedData()));
  s.publish('actor-scotty',DEMO_POST);await s.deliver();await s.deliver();
  expect(assignments).toBe(1);expect(pings).toBe(2);expect(s.deliveries().filter(d=>d.status==='needs-review')).toHaveLength(2);s.close();
 });
 it('rejects unknown authors, immutable identity edits and unsafe photos',()=>{const s=new SingularityService(':memory:',true);expect(()=>s.publish('unknown','hello')).toThrow();expect(()=>s.profile('actor-scotty',{...seedData().actors[0],email:'attacker@dsect.net'})).toThrow();expect(()=>s.profile('actor-scotty',{bio:'',title:'',interests:[],photo:'javascript:alert(1)'})).toThrow();s.close();});
 it('maps source IDs idempotently and sequentially per kind',()=>{const s=new SingularityService(':memory:',true);expect(s.handle('goal','a')).toBe('goal-001');expect(s.handle('goal','a')).toBe('goal-001');expect(s.handle('task','b')).toBe('task-001');expect(s.handle('goal','b')).toBe('goal-002');s.close();});
});
describe('REST auth and validation',()=>{
 it('fails closed with no production configuration',()=>expect(()=>createServer()).toThrow('trusted identity'));
 it('shares REST state, validates bodies and rejects cross-origin writes',async()=>{
  const {app}=createServer({demo:true});
  try {
   expect((await app.inject('/api/singularity/session')).json().actor.id).toBe('actor-scotty');
   expect((await app.inject({method:'POST',url:'/api/singularity/posts',payload:{body:''}})).statusCode).toBe(400);
   expect((await app.inject({method:'POST',url:'/api/singularity/posts',headers:{origin:'https://evil.example'},payload:{body:'hello'}})).statusCode).toBe(403);
   await app.inject({method:'POST',url:'/api/singularity/posts',payload:{body:DEMO_POST}});
   expect((await app.inject('/api/singularity/snapshot')).json().pings).toHaveLength(2);
   expect((await app.inject({method:'POST',url:'/api/singularity/posts',payload:{body:'hi',authorId:'actor-iris'}})).statusCode).toBe(400);
  } finally {await app.close();}
 });
 it('refuses spoofed identity and binds a worker to its own profile',async()=>{
  const {app}=createServer({actors:seedData().actors,proxySecret:'test-proxy-secret',workers:{'test-worker-key':'actor-iris'},backend:{} as any});
  try {
   expect((await app.inject({url:'/api/singularity/session',headers:{'tailscale-user-login':'scotty@dsect.net'}})).statusCode).toBe(401);
   expect((await app.inject({url:'/api/singularity/session',headers:{authorization:'Bearer test-worker-key'}})).json().actor.id).toBe('actor-iris');
   expect((await app.inject({url:'/api/singularity/session',headers:{'tailscale-user-login':'scotty@dsect.net','x-singularity-proxy-key':'test-proxy-secret'}})).json().actor.id).toBe('actor-scotty');
  } finally {await app.close();}
 });
});
it('registers and calls real MCP tools with transport-bound identity',async()=>{
 const service=new SingularityService(':memory:',true);
 const server=new McpServer({name:'test',version:'1'});registerSingularityTools(server,service,'actor-iris');
 const client=new Client({name:'test',version:'1'});const [a,b]=InMemoryTransport.createLinkedPair();await server.connect(a);await client.connect(b);
 try {
  const tools=await client.listTools();expect(tools.tools).toHaveLength(11);
  const post=await client.callTool({name:'singularity_post_create',arguments:{body:'Hello @Cooper #memory-001'}});
  expect(post.isError).not.toBe(true);expect(service.read().posts[0].authorId).toBe('actor-iris');
  expect(service.read().pings).toHaveLength(1);
  const bad=await client.callTool({name:'singularity_comment_create',arguments:{postId:'missing',body:'hi'}});expect(bad.isError).toBe(true);
 } finally {await client.close();await server.close();service.close();}
});
