/** Keep disposable browser data out of the local preview's shared dev account. */
export async function isolateWorkspace(context, origin) {
  await context.route((url) => {
    const id = url.pathname.match(/\/_serverFn\/([\w-]+)$/)?.[1];
    if (!id || url.origin !== new URL(origin).origin) return false;
    const manifest = Buffer.from(id, "base64url").toString("utf8");
    return /"export":"(?:loadMindCopy|saveMindCopy|saveMindChanges)_/.test(manifest);
  }, (route) => route.abort("blockedbyclient"));
}
