import { connectDB } from 'minnaldb-electron/renderer'
import { schema } from '../../shared/schema.js'

// connectDB() picks up `window.minnaldb` (installed by the preload). The
// returned object has the same shape as a local minnaldb DB, but every
// terminal (.run, .first, mutations) returns a Promise.
export const db = connectDB(schema)
export { notes } from '../../shared/schema.js'
