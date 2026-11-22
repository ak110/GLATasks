declare global {
  namespace App {
    interface Locals {
      user_id: number | null;
    }
    interface PageData {
      encrypt_key?: string;
    }
  }
}

export {};
