import { dirname } from 'node:path'
import { lstatSync, realpathSync } from 'node:fs'
import { PortabilityRecoveryTargetMaterializer } from '@personal-agent/portability'
import type { RecoveryTargetMaterializer } from '@personal-agent/contracts'
import { PRODUCT_SCHEMA_VERSION } from '@personal-agent/storage'

/** Compose D's existing exact-child materializer; the confirmed private parent is never widened. */
export function localRecoveryMaterializer(): RecoveryTargetMaterializer {
  const parents = new Map<string, PortabilityRecoveryTargetMaterializer>()
  const forRoot = (root: string) => {
    const parent = dirname(root)
    if (realpathSync(parent) !== parent) throw new Error('Recovery target parent is not canonical')
    let value = parents.get(parent)
    if (!value) { value = new PortabilityRecoveryTargetMaterializer({ trustedParent: parent, productSchema: PRODUCT_SCHEMA_VERSION }); parents.set(parent, value) }
    return value
  }
  return {
    async prepare(input) {
      const parent = lstatSync(dirname(input.source.intent.target.stateRoot))
      if (input.source.intent.target.parentIdentity !== `${parent.dev}:${parent.ino}`) throw new Error('Confirmed recovery parent was replaced')
      return forRoot(input.source.intent.target.stateRoot).prepare(input)
    },
    async read(root) { return forRoot(root).read(root) },
    async discardStaging() { throw new Error('Product recovery never discards target material') },
  }
}
