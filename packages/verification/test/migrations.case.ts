/** Migration ownership: v6 (completion evidence) and v7 (product records) are appended; v1–v5 stay byte-frozen. */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { MIGRATIONS, migrationChecksum, PRODUCT_SCHEMA_VERSION } from '@personal-agent/storage'

test('the WP-04/WP-02 migrations are appended without rewriting v1–v5', () => {
  assert.equal(migrationChecksum(MIGRATIONS[0]!), '6658f4334eaecdf265008e01c349223c4fab857697a21c1ca57c278b375f02cd')
  assert.equal(migrationChecksum(MIGRATIONS[1]!), 'a6555fed118d6c12fe8d3c92cd4f5bb5667e0dec3f7ef749adb5375903a9b1ab')
  assert.equal(migrationChecksum(MIGRATIONS[2]!), '8dc5bac776324f5d052fb26eb01c3f68327630b32542f98bdcce9a6e04ed1be6')
  assert.equal(migrationChecksum(MIGRATIONS[3]!), '9982858d05759b5d0a6fcf3bd6dff73f04cc4da56796a4a3af6e91ebb234ebec')
  assert.equal(migrationChecksum(MIGRATIONS[4]!), '0bb60a22003b219756f6cccc57a9a5ee70edfdb68f71af2d6efe863d5d27dc74')
  assert.equal(MIGRATIONS[5]!.version, 6)
  assert.equal(MIGRATIONS[5]!.name, 'completion-evidence')
  assert.equal(MIGRATIONS[6]!.version, 7)
  assert.equal(MIGRATIONS[6]!.name, 'product-records')
  assert.equal(PRODUCT_SCHEMA_VERSION, 7)
  assert.equal(PRODUCT_SCHEMA_VERSION, MIGRATIONS[MIGRATIONS.length - 1]!.version)
})
