import {it,expect} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {RichText,RefCard} from '../components/singularity/cards';
import {parseTokens} from './parse';
import {seedData} from './seed';
it('renders mentions as chips and escapes markup',()=>{
 const body='<img src=x onerror=alert(1)> @Iris #memory-001';
 const html=renderToStaticMarkup(<RichText body={body} tokens={parseTokens(body)} actors={seedData().actors}/>);
 expect(html).toContain('&lt;img');expect(html).not.toContain('<img src=x');expect(html).toContain('Iris');expect(html).toContain('memory-001');
});
it('renders the current object status, not a copied post title',()=>{
 const data=seedData();data.tasks[0].assigneeId='actor-iris';
 const html=renderToStaticMarkup(<RefCard handle="task-001-example" data={data} onOpen={()=>{}}/>);
 expect(html).toContain('Iris');expect(html).toContain('todo');
});
