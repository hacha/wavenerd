import clsx from 'clsx';
import { AssetListCategory } from './AssetListCategory';

// == components ===================================================================================
export function AssetList({ className }: {
  className?: string;
}) {
  return (
    <div className={clsx('flex flex-col', className)}>
      <AssetListCategory
        title="Shaders"
        dir="shaders"
        defaultExpand={false}
      />
      <AssetListCategory
        title="Strudel"
        noun="Strudel sketches"
        dir="strudel"
      />
      <AssetListCategory
        title="Samples"
        dir="samples"
      />
      <AssetListCategory
        title="Wavetables"
        dir="wavetables"
      />
      <AssetListCategory
        title="Images"
        dir="images"
        defaultExpand={false}
      />
    </div>
  );
}
