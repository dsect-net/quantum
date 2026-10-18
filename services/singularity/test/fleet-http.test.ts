import {it,expect} from 'vitest';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {createServer} from '../src/fleet/server.js';
it('performs MCP initialize, list and call over actual HTTP',async()=>{
 const {app}=createServer({demo:true});const address=await app.listen({port:0,host:'127.0.0.1'});
 const client=new Client({name:'http-test',version:'1'});
 try {
  await client.connect(new StreamableHTTPClientTransport(new URL(address+'/mcp')));
  expect((await client.listTools()).tools).toHaveLength(11);
  const result=await client.callTool({name:'singularity_post_create',arguments:{body:'Hello @Cooper'}});
  expect(result.isError).not.toBe(true);
  const feed=await client.callTool({name:'singularity_feed_list',arguments:{}});
  expect(JSON.parse((feed.content as any)[0].text)[0].body).toBe('Hello @Cooper');
 }finally{await client.close();await app.close();}
});
