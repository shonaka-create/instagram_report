import { redirect } from "next/navigation";

// トップは一覧へ(サイト全体がパスワード保護されている前提)
export default function Home() {
  redirect("/reports");
}
