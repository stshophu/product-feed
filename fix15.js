const fs = require('fs');
let code = fs.readFileSync('sync.js', 'utf8');

// Handle cursor error by deleting and recreating
code = code.replace(
  `        await upsertProduct(payload);
        stats.synced++;`,
  `        try {
          await upsertProduct(payload);
        } catch(upsertErr) {
          const msg = upsertErr.response ? JSON.stringify(upsertErr.response.data) : upsertErr.message;
          if (msg.includes('Cursor not valid')) {
            // Delete and recreate
            await deleteProduct(payload.identifier);
            await upsertProduct(payload);
          } else {
            throw upsertErr;
          }
        }
        stats.synced++;`
);

fs.writeFileSync('sync.js', code);
console.log('Done');
