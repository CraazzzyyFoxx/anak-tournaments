import { Suspense } from "react";

import UsersRedesignClient from "./components/index/UsersRedesignClient";

const UsersPage = () => {
  return (
    <Suspense fallback={null}>
      <UsersRedesignClient />
    </Suspense>
  );
};

export default UsersPage;
