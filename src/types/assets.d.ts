/** Metro resolves image imports to an asset id usable as an <Image> source. */
declare module "*.png" {
  const assetId: number;
  export default assetId;
}
