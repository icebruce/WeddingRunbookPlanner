// One rule set, shared with the browser. The module itself lives under
// public/src so the client can fetch it; the server imports the same file
// rather than keeping a second copy in step.
export * from '../../public/src/validate.js';
