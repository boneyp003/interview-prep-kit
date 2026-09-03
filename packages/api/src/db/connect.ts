import mongoose from "mongoose";

let connecting: Promise<typeof mongoose> | null = null;

export async function connectDb(uri: string): Promise<typeof mongoose> {
  if (mongoose.connection.readyState === 1) return mongoose;
  if (!connecting) {
    mongoose.set("strictQuery", true);
    connecting = mongoose.connect(uri, { serverSelectionTimeoutMS: 5000 });
  }
  return connecting;
}

export async function disconnectDb(): Promise<void> {
  connecting = null;
  await mongoose.disconnect();
}
