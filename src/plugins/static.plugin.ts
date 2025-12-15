import { staticPlugin } from '@elysiajs/static';

export const staticFilesPlugin = staticPlugin({
  assets: 'downloads',
  prefix: '/downloads',
});
