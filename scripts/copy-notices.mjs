import { copyFile } from "node:fs/promises";
await copyFile("THIRD_PARTY_NOTICES.txt", "dist/THIRD_PARTY_NOTICES.txt");
