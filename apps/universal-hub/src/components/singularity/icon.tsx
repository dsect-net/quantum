/** Small consistent stroke icons; decorative only, accessible names live on controls. */
export type IconName = 'feed' | 'people' | 'pings' | 'settings' | 'search' | 'plus' | 'arrow' | 'bookmark' | 'link' | 'check' | 'message' | 'spark' | 'chevron' | 'close' | 'activity';
const paths: Record<IconName, string> = {
  feed: 'M4 4h6v6H4z M14 4h6v6h-6z M4 14h6v6H4z M14 14h6v6h-6z',
  people: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M22 21v-2a4 4 0 0 0-3-3.87 M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8 M16 3.13a4 4 0 0 1 0 7.75',
  pings: 'M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9 M10 21h4',
  settings: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8 M12 2v3 M12 19v3 M2 12h3 M19 12h3 M5 5l2 2 M17 17l2 2 M5 19l2-2 M17 7l2-2',
  search: 'M21 21l-4.4-4.4 M10.5 3a7.5 7.5 0 1 0 0 15 7.5 7.5 0 0 0 0-15',
  plus: 'M12 5v14 M5 12h14', arrow: 'M5 12h14 M13 6l6 6-6 6',
  bookmark: 'M6 3h12v18l-6-4-6 4z', link: 'M10 13a5 5 0 0 0 7 .5l3-3a5 5 0 0 0-7-7l-2 2 M14 11a5 5 0 0 0-7-.5l-3 3a5 5 0 0 0 7 7l2-2',
  check: 'M5 12l4 4L19 6', message: 'M21 11a8 8 0 0 1-8 8H7l-4 3V11a9 9 0 0 1 18 0z',
  spark: 'M12 3l2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5z',
  chevron: 'M9 5l7 7-7 7',close:'M6 6l12 12 M6 18L18 6',activity:'M3 12h4l3-8 4 16 3-8h4',
};
export function Icon({name,size=18,className=''}:{name:IconName;size?:number;className?:string}) {
 return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={className}><path d={paths[name]}/></svg>;
}
