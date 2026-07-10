import { z } from "zod";

export const TelemetryResourceSchema = z
  .object({
    serviceName: z.string().trim().min(1),
    serviceVersion: z.string().trim().min(1),
    serviceNamespace: z.string().trim().min(1).default("spec-to-pr"),
    deploymentEnvironment: z
      .enum(["development", "test", "staging", "production"])
      .default("development"),
    instanceId: z.string().trim().min(1).optional(),
  })
  .strict();

export type TelemetryResource = z.infer<typeof TelemetryResourceSchema>;

export function toOpenTelemetryResourceAttributes(resource: TelemetryResource) {
  const parsed = TelemetryResourceSchema.parse(resource);

  return {
    "service.name": parsed.serviceName,
    "service.version": parsed.serviceVersion,
    "service.namespace": parsed.serviceNamespace,
    "deployment.environment.name": parsed.deploymentEnvironment,
    ...(parsed.instanceId === undefined
      ? {}
      : {
          "service.instance.id": parsed.instanceId,
        }),
  };
}
