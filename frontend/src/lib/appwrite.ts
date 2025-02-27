import { Client, Account } from "appwrite";

export const client = new Client();

client.setEndpoint("https://cloud.appwrite.io/v1").setProject("676a8edf0030359c8c28"); // Replace with your project ID

export const account = new Account(client);
export { ID } from "appwrite";
