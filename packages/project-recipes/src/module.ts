/**
 * Runtime self-description for a same-version hand-off.
 *
 * D freezes one package and E verifies one exact tar; a caller that compares this description
 * between source and the installed artifact can tell whether the same contracts, catalog and issue
 * vocabulary are present. It carries no path, credential or authority.
 */
import { RECIPE_KINDS } from './catalog.ts'
import { RECIPE_DRAFT_PROTOCOL, RECIPE_ISSUE_CODES } from './draft.ts'
import { PROJECT_FACTS_PROTOCOL } from './facts.ts'
import { PREVIEW_ERROR_CODES, CREATE_WORK_FIELDS_PROTOCOL } from './preview.ts'
import { FACTS_OBSERVER_PROTOCOL } from './observe.ts'
import { REBIND_PROTOCOL } from './rebind.ts'
import { catalogDigest } from './match.ts'

export const MODULE_PROTOCOL = 'project-recipes-module/1' as const
export const MODULE_NAME = '@personal-agent/project-recipes' as const
/** Kept in step with package.json by a test. */
export const MODULE_VERSION = '0.1.0' as const

export interface ProjectRecipesModuleDescription {
  readonly protocol: typeof MODULE_PROTOCOL
  readonly name: typeof MODULE_NAME
  readonly version: string
  readonly catalog: { readonly id: string; readonly version: number; readonly digest: string }
  readonly kinds: readonly string[]
  readonly protocols: {
    readonly facts: string
    readonly draft: string
    readonly fields: string
    readonly observer: string
    readonly rebind: string
  }
  readonly issueCodes: readonly string[]
  readonly previewErrorCodes: readonly string[]
  /** Configuration protocol this module understands; anything else is refused. */
  readonly configurationProtocols: readonly string[]
  /** Data only: suggestions never carry or imply execution authority. */
  readonly authority: 'none'
}

export function describeProjectRecipes(): ProjectRecipesModuleDescription {
  return Object.freeze({
    protocol: MODULE_PROTOCOL,
    name: MODULE_NAME,
    version: MODULE_VERSION,
    catalog: Object.freeze({ id: 'project-recipes', version: 1, digest: catalogDigest() }),
    kinds: Object.freeze([...RECIPE_KINDS]),
    protocols: Object.freeze({
      facts: PROJECT_FACTS_PROTOCOL,
      draft: RECIPE_DRAFT_PROTOCOL,
      fields: CREATE_WORK_FIELDS_PROTOCOL,
      observer: FACTS_OBSERVER_PROTOCOL,
      rebind: REBIND_PROTOCOL,
    }),
    issueCodes: Object.freeze([...RECIPE_ISSUE_CODES]),
    previewErrorCodes: Object.freeze([...PREVIEW_ERROR_CODES]),
    configurationProtocols: Object.freeze(['application-configuration/1']),
    authority: 'none' as const,
  })
}
