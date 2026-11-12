/** Independent writer process for wave-15 source consistency tests. */
import { ProductStore } from '../../../../packages/storage/dist/index.js'
const [path, id] = process.argv.slice(2)
const store = new ProductStore({ path })
store.product.works.insert({ id, projectId: 'project-1', conversationId: 'conversation-1', title: 'Independent writer', createdAt: '2026-11-12T00:00:00.000Z' })
store.close()
