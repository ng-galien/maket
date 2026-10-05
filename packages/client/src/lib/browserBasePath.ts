/** Prefix supplied by the Maket app shell when a gateway hosts its browser view. */
export function browserBasePath(): string {
	return (
		document.querySelector<HTMLMetaElement>('meta[name="maket-base-path"]')
			?.content ?? ""
	);
}

export function linkedDocumentId(pathname: string): string | null {
	const basePath = browserBasePath();
	const path =
		basePath && pathname.startsWith(`${basePath}/`)
			? pathname.slice(basePath.length)
			: pathname;
	return /^\/documents\/([^/]+)\/read\/?$/.exec(path)?.[1] ?? null;
}

export function browserPath(path: `/${string}`): string {
	return `${browserBasePath()}${path}`;
}

export function prefixDocumentAssetUrls(html: string): string {
	const basePath = browserBasePath();
	if (!basePath) return html;
	return html
		.replace(/(\b(?:src|href)=["'])\/assets\//gi, `$1${basePath}/assets/`)
		.replace(/(url\(\s*["']?)\/assets\//gi, `$1${basePath}/assets/`);
}
