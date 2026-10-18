import {it,expect,vi,afterEach} from 'vitest';
import {QuantumBackend} from '../src/backend.ts';
import {seedData} from '../../../apps/universal-hub/src/singularity/seed.ts';
afterEach(()=>vi.unstubAllGlobals());
it('reads existing collab paths, retains IDs, and normalizes progress',async()=>{
 const fetcher=vi.fn(async(url:string)=>new Response(JSON.stringify(url.endsWith('/goals')?[{id:'real-goal',title:'Real goal',status:'active',progress:.4,owner:'scotty'}]:{columns:{todo:[{id:'real-task',title:'Real task',status:'todo',assignee:'iris'}],doing:[],done:[]}}),{status:200}));
 vi.stubGlobal('fetch',fetcher);const backend=new QuantumBackend('https://hub.example','not-a-real-key');
 const data=await backend.refresh(seedData(),(kind,id)=>kind+'-'+id);
 expect(data.goals?.[0].progress).toBe(40);expect(data.tasks?.[0].id).toBe('real-task');expect(data.tasks?.[0].assigneeId).toBe('actor-iris');
 await backend.assign('real-task',seedData().actors[2]);
 expect(fetcher.mock.calls.at(-1)?.[0]).toBe('https://hub.example/api/collab/tasks/real-task');
});
it('calls quantum_agent_ping through the existing handshake and propagates tool errors',async()=>{
 const requests:Array<any>=[];
 vi.stubGlobal('fetch',async(_url:string,options:any)=>{
  const body=JSON.parse(options.body);requests.push(body);
  if(body.method==='initialize')return new Response(JSON.stringify({result:{}}),{headers:{'mcp-session-id':'test-session'}});
  if(body.method==='notifications/initialized')return new Response(null,{status:202});
  return new Response(JSON.stringify({result:{isError:true}}));
 });
 const data=seedData();const backend=new QuantumBackend('https://hub.example','not-a-real-key');
 await expect(backend.ping({id:'p',toId:'actor-cooper',fromId:'actor-scotty',kind:'mention',subject:'Hello',summary:'Test',postId:'post',acked:false,createdAt:''},data)).rejects.toThrow('refused');
 expect(requests[1].id).toBeUndefined();expect(requests[2].params.name).toBe('quantum_agent_ping');expect(requests[2].params.arguments.to).toBe('cooper');
});
