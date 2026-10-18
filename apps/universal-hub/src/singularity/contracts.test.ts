import {describe,it,expect} from 'vitest';
import {parseTokens,mentionHandles,refHandles} from './parse';
import {nextHandle,resolveRef} from './handles';
import {seedData,DEMO_POST} from './seed';
import {planRoute} from './routing';
import {publishPost,publishComment} from './domain';
describe('structured tokens',()=>{
 it('round trips punctuation and stores tokens, not copied titles',()=>{
  const text='Hi @Cooper, see #goal-001-example.';
  expect(parseTokens(text).map(t=>t.type==='text'?t.text:(t.type==='mention'?'@':'#')+t.handle).join('')).toBe(text);
  expect(mentionHandles(parseTokens(text))).toEqual(['Cooper']);
  expect(refHandles(parseTokens(text))).toEqual(['goal-001-example']);
 });
 it('does not ping email addresses or embedded words',()=>expect(mentionHandles(parseTokens('cooper@dsect.net abc@Iris https://host/@Cooper'))).toEqual([]));
 it('leaves unknown tags and markup as safe text',()=>expect(parseTokens('<script>x</script> #hello')).toEqual([{type:'text',text:'<script>x</script> #hello'}]));
});
describe('handles and live references',()=>{
 it('allocates per type',()=>expect(nextHandle(['goal-003-old','task-090'],'goal','New goal')).toBe('goal-004-new-goal'));
 it('resolves short aliases and reads changed state',()=>{const d=seedData();d.goals[0].title='Changed';expect(resolveRef(d,'goal-001')?.title).toBe('Changed');expect(resolveRef(d,'goal-999')).toBeNull();});
});
describe('routing',()=>{
 it('routes the exact design request without assigning Cooper',()=>{
  const d=seedData(),plan=planRoute(d,DEMO_POST,'actor-scotty');
  expect(plan.assignments).toEqual([{taskId:'task-1',assigneeId:'actor-iris',handle:'task-001-example'}]);
  expect(plan.pings.map(p=>[p.toId,p.kind])).toEqual([['actor-cooper','mention'],['actor-iris','task']]);
 });
 it('does not assign casual or explicitly negated references',()=>{
  for(const text of ['@Iris, have you seen #task-001-example?','@Iris do not work on #task-001-example']) expect(planRoute(seedData(),text,'actor-scotty').assignments).toEqual([]);
 });
 it('deduplicates mention pings and ignores unknown actors',()=>expect(planRoute(seedData(),'@Cooper @Cooper @Unknown','actor-scotty').pings).toHaveLength(1));
 it('comments use the same routing and missing threads fail',()=>{
  const d=seedData();expect(publishComment(d,'actor-scotty','missing',DEMO_POST).error).toBeTruthy();
  expect(publishComment(d,'actor-scotty',d.posts[0].id,DEMO_POST).data.tasks[0].assigneeId).toBe('actor-iris');
 });
 it('rejects empty and oversized posts',()=>{expect(publishPost(seedData(),'actor-scotty',' ').error).toBeTruthy();expect(publishPost(seedData(),'actor-scotty','x'.repeat(2001)).error).toBeTruthy();});
});
