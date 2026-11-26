declare module "virtual:adrian-native-build-identity" {
  export const nativeBuildIdentity: { product: "adrians-mind"; build: number; version: string; revision: string | null; artifactId: string; dirty: boolean; builtAt: string };
}
