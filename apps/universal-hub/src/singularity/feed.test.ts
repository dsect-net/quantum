import {it,expect} from 'vitest';
import {filterFeed} from './feed';
import {seedData} from './seed';
import {publishPost} from './domain';
it('combines author/body search with structural linked and mention filters',()=>{
 const d=publishPost(seedData(),'actor-iris','Hello @Scotty').data;
 expect(filterFeed(d.posts,d.actors,'actor-scotty','iris','mentions',[])).toHaveLength(1);
 expect(filterFeed(d.posts,d.actors,'actor-scotty','','linked',[])).toHaveLength(1);
 expect(filterFeed(d.posts,d.actors,'actor-scotty','absent','all',[])).toHaveLength(0);
});
it('only shows explicitly saved IDs and supports case-insensitive handles',()=>{
 const d=seedData();expect(filterFeed(d.posts,d.actors,'actor-scotty','','saved',[])).toEqual([]);
 expect(filterFeed(d.posts,d.actors,'actor-scotty','GOAL-001','saved',[d.posts[0].id])).toHaveLength(1);
});
