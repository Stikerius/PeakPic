import { useEffect, useState } from "react";

/**
 * Tiny hash router: #/queue, #/reports/<id>, #/users, #/users/<id>, #/audit, #/legal,
 * #/legal/<id>, #/pending, #/usage, #/reset, #/reset/<id>, #/mail, #/mail/<id>, #/logos, #/design, #/surveys,
 * #/surveys/new, #/surveys/<id>, #/surveys/<id>/results, #/ (overview).
 */
export type Route =
  | { page: "overview" }
  | { page: "queue" }
  | { page: "report"; id: string }
  | { page: "users" }
  | { page: "user"; id: string }
  | { page: "audit" }
  | { page: "legal" }
  | { page: "legal-edit"; id: string }
  | { page: "pending" }
  | { page: "usage" }
  | { page: "reset" }
  | { page: "reset-job"; id: string }
  | { page: "mail" }
  | { page: "mail-campaign"; id: string }
  | { page: "logos" }
  | { page: "design" }
  | { page: "surveys" }
  | { page: "survey-edit"; id: string | null }
  | { page: "survey-results"; id: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseRoute(hash: string): Route {
  const parts = hash.replace(/^#\/?/, "").split("/").filter((p) => p !== "");
  const [first, second, third] = parts;
  if (first === "queue") return { page: "queue" };
  if (first === "reports" && second !== undefined && UUID.test(second)) return { page: "report", id: second };
  if (first === "users" && second !== undefined && UUID.test(second)) return { page: "user", id: second };
  if (first === "users") return { page: "users" };
  if (first === "audit") return { page: "audit" };
  if (first === "legal" && second !== undefined && UUID.test(second)) return { page: "legal-edit", id: second };
  if (first === "legal") return { page: "legal" };
  if (first === "pending") return { page: "pending" };
  if (first === "usage") return { page: "usage" };
  if (first === "reset" && second !== undefined && UUID.test(second)) return { page: "reset-job", id: second };
  if (first === "reset") return { page: "reset" };
  if (first === "mail" && second !== undefined && UUID.test(second)) return { page: "mail-campaign", id: second };
  if (first === "mail") return { page: "mail" };
  if (first === "logos") return { page: "logos" };
  if (first === "design") return { page: "design" };
  if (first === "surveys" && second === "new") return { page: "survey-edit", id: null };
  if (first === "surveys" && second !== undefined && UUID.test(second)) {
    return third === "results" ? { page: "survey-results", id: second } : { page: "survey-edit", id: second };
  }
  if (first === "surveys") return { page: "surveys" };
  return { page: "overview" };
}

export function href(route: Route): string {
  switch (route.page) {
    case "overview":
      return "#/";
    case "queue":
      return "#/queue";
    case "report":
      return `#/reports/${route.id}`;
    case "users":
      return "#/users";
    case "user":
      return `#/users/${route.id}`;
    case "audit":
      return "#/audit";
    case "legal":
      return "#/legal";
    case "legal-edit":
      return `#/legal/${route.id}`;
    case "pending":
      return "#/pending";
    case "usage":
      return "#/usage";
    case "reset":
      return "#/reset";
    case "reset-job":
      return `#/reset/${route.id}`;
    case "mail":
      return "#/mail";
    case "mail-campaign":
      return `#/mail/${route.id}`;
    case "logos":
      return "#/logos";
    case "surveys":
      return "#/surveys";
    case "survey-edit":
      return route.id === null ? "#/surveys/new" : `#/surveys/${route.id}`;
    case "survey-results":
      return `#/surveys/${route.id}/results`;
    case "design":
      return "#/design";
  }
}

export function navigate(route: Route): void {
  window.location.hash = href(route);
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.hash));
  useEffect(() => {
    const onChange = () => setRoute(parseRoute(window.location.hash));
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return route;
}
