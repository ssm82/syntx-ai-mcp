import type { SyntxResource, SyntxResourceTemplate } from '../registry';
import { staticResources } from './static';
import { resourceTemplates } from './templates';

export const allResources: SyntxResource[] = staticResources;
export const allResourceTemplates: SyntxResourceTemplate[] = resourceTemplates;
