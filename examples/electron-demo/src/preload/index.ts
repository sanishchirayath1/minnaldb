import { exposeMinnaldbBridge } from 'minnaldb-electron/preload'

// One line — that's the entire preload. The helper installs a typed bridge
// at `window.minnaldb` that connectDB() picks up automatically in the renderer.
exposeMinnaldbBridge()
