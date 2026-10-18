/** Real browser + real SQLite REST service. Start service with explicit demo mode.
 * Optional CHROMIUM_EXECUTABLE_PATH for preinstalled Chromium in restricted CI.
 */
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
const base=process.env.BASE_URL??'http://127.0.0.1:5173';
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE_PATH||undefined,args:['--no-sandbox','--disable-dev-shm-usage']});
const out=new URL('../screenshots/',import.meta.url);await mkdir(out,{recursive:true});
const errors=[];
try {
 for (const [device,width,height] of [['mobile',390,844],['desktop',1280,900]]) {
  const context=await browser.newContext({viewport:{width,height}});
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base);
  await page.getByRole('button',{name:'Continue with DSECT'}).waitFor();
  await page.screenshot({path:new URL(`verified-login-${device}.png`,out).pathname});
  await page.getByRole('button',{name:'Continue with DSECT'}).click();
  await page.getByText('Shared service demo', {exact:false}).waitFor();
  await page.getByRole('button',{name:'Use the example'}).click();
  await page.screenshot({path:new URL(`verified-composer-${device}.png`,out).pathname});
  const created=page.waitForResponse(r=>r.url().endsWith('/api/singularity/posts')&&r.request().method()==='POST');
  await page.getByRole('button',{name:'Post',exact:true}).click();
  assert.equal((await created).status(),200);
  await page.waitForFunction(()=>document.querySelector('textarea')?.value==='');
  await page.getByText('Assignee Iris',{exact:true}).first().waitFor();
  await page.screenshot({path:new URL(`verified-feed-${device}.png`,out).pathname});
  const state=await (await context.request.get(base+'/api/singularity/snapshot')).json();
  assert.equal(state.tasks[0].assigneeId,'actor-iris');
  assert(state.pings.some(p=>p.toId==='actor-cooper'&&p.kind==='mention'));
  assert(state.pings.some(p=>p.toId==='actor-iris'&&p.kind==='task'));
  const newest=state.posts[0].id;
  const card=page.locator('article').first();
  await card.getByRole('button',{name:'Comment',exact:true}).click();
  const comment=card.locator('textarea');await comment.fill('Reference this #memory-001, @Cooper.');
  await card.getByRole('button',{name:'Reply',exact:true}).click();
  await card.getByText('Reference this',{exact:false}).waitFor();
  await card.getByRole('button',{name:/^Useful/}).click();
  // New workspace controls: search, structural filters, saved reading list.
  await card.getByRole('button',{name:'Save post',exact:true}).click();
  await page.getByRole('button',{name:/^Saved/}).click();
  assert.equal(await page.locator('article').count(),1);
  assert.equal(await page.getByRole('button',{name:'Unsave post',exact:true}).count(),1);
  await page.getByRole('button',{name:'Mentions',exact:true}).click();
  await page.getByRole('heading',{name:'No conversations found.'}).waitFor();
  await page.getByRole('button',{name:'Linked work',exact:true}).click();
  await page.getByRole('textbox',{name:'Search feed'}).fill('does-not-exist-anywhere');
  await page.getByRole('heading',{name:'No conversations found.'}).waitFor();
  await page.getByRole('button',{name:'Clear search'}).click();
  await page.getByRole('button',{name:'All posts',exact:true}).click();
  await page.getByRole('textbox',{name:'Search feed'}).fill('scotty');
  assert(await page.locator('article').count()>0);
  await page.getByRole('button',{name:'Clear search'}).click();
  await page.getByRole('textbox',{name:'Search feed'}).blur();
  await page.keyboard.press('/');
  assert.equal(await page.getByRole('textbox',{name:'Search feed'}).evaluate(el=>el===document.activeElement),true);
  await page.screenshot({path:new URL(`verified-search-${device}.png`,out).pathname});
  await page.evaluate(()=>location.hash='#/pings');
  await page.getByText('Iris · task').first().waitFor();
  await page.screenshot({path:new URL(`verified-pings-${device}.png`,out).pathname});
  await page.evaluate(()=>location.hash='#/o/goal-001-example');
  await page.getByRole('heading',{name:'Stand up Singularity as the fleet hub'}).waitFor();
  await page.screenshot({path:new URL(`verified-goal-${device}.png`,out).pathname});
  await page.evaluate(()=>location.hash='#/o/task-001-example');
  await page.getByRole('heading',{name:'Wire mention routing so Iris can take the task'}).waitFor();
  await page.screenshot({path:new URL(`verified-task-${device}.png`,out).pathname});
  await page.evaluate(()=>location.hash='#/u/Scotty');
  await page.getByRole('textbox',{name:'Bio',exact:true}).fill('E2E verified shared Quantum profile');
  const saved=page.waitForResponse(r=>r.url().endsWith('/api/singularity/profile')&&r.request().method()==='PATCH');
  await page.getByRole('button',{name:'Save profile'}).click();assert.equal((await saved).status(),200);
  await page.waitForFunction(()=>document.querySelector('textarea')?.value==='E2E verified shared Quantum profile');
  const after=await (await context.request.get(base+'/api/singularity/snapshot')).json();
  assert(after.comments.some(c=>c.postId===newest&&c.body.includes('#memory-001')));
  // On reload, a server identity is revalidated, never trusted from localStorage.
  await page.reload();await page.getByRole('button',{name:'Continue with DSECT'}).click();
  await page.getByRole('textbox',{name:'Bio',exact:true}).waitFor();
  assert.equal(await page.getByRole('textbox',{name:'Bio',exact:true}).inputValue(),'E2E verified shared Quantum profile');
  await page.screenshot({path:new URL(`verified-profile-${device}.png`,out).pathname});
  await page.evaluate(()=>location.hash='#/');
  await page.getByRole('button',{name:/^Saved/}).click();
  assert.equal(await page.locator('article').count(),1);
  await page.screenshot({path:new URL(`verified-saved-${device}.png`,out).pathname});
  await page.getByRole('button',{name:'Unsave post',exact:true}).click();
  await page.getByRole('heading',{name:'A little space for later.'}).waitFor();
  await page.getByRole('button',{name:'All posts',exact:true}).click();
  await page.getByRole('button',{name:'Insert mention',exact:true}).first().click();
  await page.getByRole('list',{name:'Mention and reference suggestions'}).waitFor();
  await page.getByRole('list',{name:'Mention and reference suggestions'}).getByRole('button',{name:/Cooper/}).click();
  assert((await page.locator('textarea').first().inputValue()).includes('@Cooper'));
  await page.locator('textarea').first().fill('');
  if(device==='desktop') {
    await page.getByRole('button',{name:'Create a post',exact:true}).click();
    assert.equal(await page.locator('textarea').first().evaluate(el=>el===document.activeElement),true);
    await page.getByRole('button',{name:'View fleet directory'}).click();
    await page.getByRole('heading',{name:'Directory',exact:true}).waitFor();
  }
  await page.evaluate(()=>location.hash='#/settings');
  await page.getByRole('switch').check();await page.getByRole('button',{name:'Run self-checks'}).click();
  assert.equal(await page.getByText(/^Fail ·/).count(),0);
  await page.screenshot({path:new URL(`verified-settings-${device}.png`,out).pathname});
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  // Offline shell is available, but authenticated API responses are not cached.
  await page.evaluate(async()=>{await navigator.serviceWorker.ready;});
  const cacheUrls=await page.evaluate(async()=>{const names=await caches.keys();return (await Promise.all(names.map(async n=>(await (await caches.open(n)).keys()).map(r=>r.url)))).flat();});
  assert(cacheUrls.every(u=>!u.includes('/api/')));
  await context.setOffline(true);await page.reload();
  await page.getByRole('button',{name:'Enter the seeded fleet as Scotty'}).click();
  await page.getByText('Offline demo · changes stay on this device; no agents are contacted.').waitFor();
  await context.close();
  console.log(`PASS ${device}: shared post → chips → assignment/pings; comment, reaction, profile reload, diagnostics, offline shell`);
 }
 assert.deepEqual(errors,[]);
} finally {await browser.close();}
