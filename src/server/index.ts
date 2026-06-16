import { createApp } from "./app";

const port = Number(process.env.PORT ?? 3001);

async function main() {
  const app = await createApp();
  app.listen(port, () => {
    console.log(`API server listening on http://localhost:${port}`);
  });
}

void main();
