// wrangler bundles .sh files as text (see the rules in wrangler.jsonc)
declare module "*.sh" {
  const text: string;
  export default text;
}
