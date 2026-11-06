// Resolve from this repository, independently of the working directory.
export const website = new URL('../../', import.meta.url);
export const websiteFile = (path) => new URL(path, website);
