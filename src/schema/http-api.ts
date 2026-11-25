/**
 * `HttpApi`-Definition der API M3b (Spec M3b Teil A, Tabelle „API M3b“, REQ-API-4). Liegt bewusst
 * nicht im Barrel `index.ts`: sie hängt an `@effect/platform`, das Frontend nutzt Effect nur als
 * Schema (Entscheidung 7).
 *
 * Die Schemas kommen aus `api.ts`; der Server kodiert seine Antworten mit genau diesen Schemas.
 * Endpunktnamen entstehen aus Methode und Pfad, Statuscodes über `withStatus`.
 */
import { HttpApi, HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from "@effect/platform";
import type { HttpMethod } from "@effect/platform/HttpMethod";
import { Schema } from "effect";
import {
  DeleteQuerySchema,
  FremderHost,
  GespeichertUngueltig,
  InventoryStateSchema,
  InventoryWrittenSchema,
  LayoutPathSchema,
  LayoutStateSchema,
  LayoutSummarySchema,
  NichtGefunden,
  PutInventoryRequestSchema,
  PutLayoutRequestSchema,
  ServerFehler,
  StatusSchema,
  UngueltigeAnfrage,
  VersionKonflikt,
  ZuGross,
} from "./api.js";

/** Kennung der API und erstes Pfadsegment. */
const API = "api";

const endpoint = <M extends HttpMethod>(method: M, path: `/${string}`) =>
  HttpApiEndpoint.make(method)(`${method} ${path}`, path);

const withStatus = <S extends Schema.Schema.Any>(schema: S, status: number): S =>
  schema.annotations(HttpApiSchema.annotations({ status })) as S;

/** 415: Anfragekörper ohne `Content-Type: application/json` (ohne Körper). */
const FalscherInhaltstyp = HttpApiSchema.Empty(415);

export const CarreraApi = HttpApi.make(API)
  .addError(withStatus(FremderHost, 421))
  .addError(withStatus(ServerFehler, 500))
  .add(
    HttpApiGroup.make(API)
      .add(endpoint("GET", `/${API}/status`).addSuccess(StatusSchema))
      .add(endpoint("GET", `/${API}/layouts`).addSuccess(Schema.Array(LayoutSummarySchema)))
      .add(
        endpoint("GET", `/${API}/layouts/:name`)
          .setPath(LayoutPathSchema)
          .addSuccess(LayoutStateSchema)
          .addError(withStatus(UngueltigeAnfrage, 400))
          .addError(withStatus(NichtGefunden, 404))
          .addError(withStatus(GespeichertUngueltig, 500)),
      )
      .add(
        endpoint("PUT", `/${API}/layouts/:name`)
          .setPath(LayoutPathSchema)
          .setPayload(PutLayoutRequestSchema)
          .addSuccess(LayoutSummarySchema)
          .addSuccess(withStatus(LayoutSummarySchema, 201))
          .addError(withStatus(UngueltigeAnfrage, 400))
          .addError(withStatus(VersionKonflikt, 409))
          .addError(withStatus(ZuGross, 413))
          .addError(FalscherInhaltstyp),
      )
      .add(
        endpoint("DELETE", `/${API}/layouts/:name`)
          .setPath(LayoutPathSchema)
          .setUrlParams(DeleteQuerySchema)
          .addError(withStatus(UngueltigeAnfrage, 400))
          .addError(withStatus(NichtGefunden, 404))
          .addError(withStatus(VersionKonflikt, 409)),
      )
      .add(
        endpoint("GET", `/${API}/bestand`)
          .addSuccess(InventoryStateSchema)
          .addError(withStatus(GespeichertUngueltig, 500)),
      )
      .add(
        endpoint("PUT", `/${API}/bestand`)
          .setPayload(PutInventoryRequestSchema)
          .addSuccess(InventoryWrittenSchema)
          .addError(withStatus(UngueltigeAnfrage, 400))
          .addError(withStatus(VersionKonflikt, 409))
          .addError(withStatus(ZuGross, 413))
          .addError(FalscherInhaltstyp),
      ),
  );
