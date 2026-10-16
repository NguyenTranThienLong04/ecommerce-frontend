
const dashboardCharts = {};
let revenueRequest = 0;
function dashboardChart(id, options) {
  dashboardCharts[id]?.destroy?.();
  dashboardCharts[id] = new Chart(document.getElementById(id), options);
}
async function loadDashboard() {
  try {
  const res = await Api.admin(window.AppConfig.apiBase + "/admin/dashboard", {
    headers: { Authorization: `Bearer ${localStorage.getItem("adminToken")}` }
  });
  const data = await res.json();
  if (!data || ["totalProducts", "totalOrders", "totalUsers", "revenue"].some(key => !Number.isFinite(data[key])) ||
      !data.statusStats || typeof data.statusStats !== "object" || Array.isArray(data.statusStats) ||
      Object.values(data.statusStats).some(count => !Number.isFinite(count))) throw Api.error(502, {}, "INVALID_RESPONSE");

  document.getElementById("totalProducts").innerText = data.totalProducts;
  document.getElementById("totalOrders").innerText = data.totalOrders;
  document.getElementById("totalUsers").innerText = data.totalUsers;
  document.getElementById("revenue").innerText =
    data.revenue.toLocaleString("vi-VN");

  renderStatusChart(data.statusStats);
  loadRevenueChart();
  loadRecentOrders();
  loadTopProducts();
  loadTopUsers();
  } catch (error) { Api.report(error, loadDashboard); }
}

// ===== STATUS =====
function renderStatusChart(statusStats) {
  dashboardChart("statusChart", {
    type: "bar",
    data: {
      labels: Object.keys(statusStats),
      datasets: [{
        label: "Orders",
        data: Object.values(statusStats)
      }]
    }
  });
}

// ===== REVENUE =====
async function loadRevenueChart() {
  const request = ++revenueRequest;
  try {
  const month = document.getElementById("month")?.value;
  const year = document.getElementById("year")?.value;

  const res = await Api.admin(
    `${window.AppConfig.apiBase}/admin/revenue-by-date?month=${month}&year=${year}`
    , {
    headers: { Authorization: `Bearer ${localStorage.getItem("adminToken")}`}
  }
  );

  const data = Api.list(await res.json());
  if (request !== revenueRequest) return;
  dashboardChart("revenueChart", {
    type: "line",
    data: {
      labels: data.map(i => i.date),
      datasets: [{
        label: "Revenue",
        data: data.map(i => i.revenue)
      }]
    }
  });
  } catch (error) { if (request === revenueRequest) Api.report(error, loadRevenueChart); }
}

// ===== RECENT =====
// ===== RECENT =====
async function loadRecentOrders() {
  try {
    const token = localStorage.getItem("adminToken");

    const res = await Api.admin(window.AppConfig.apiBase + "/orders", {
      headers: {
       Authorization: `Bearer ${localStorage.getItem("adminToken")}`
      }
    });

    const data = await res.json();

    // handle trường hợp backend trả {orders: []}
    const orders = Api.list(Array.isArray(data) ? data : data?.orders);

    if (!orders || orders.length === 0) {
      document.getElementById("recentOrders").innerHTML =
        "<tr><td colspan='4'>No orders</td></tr>";
      return;
    }

    const recent = [...orders]
  .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
  .slice(0, 5);

    document.getElementById("recentOrders").innerHTML =
      recent.map(o => SafeHTML.html`
        <tr>
          <td>#${o._id.slice(-6)}</td>
          <td>${(o.total || 0).toLocaleString("vi-VN")} đ</td>
          <td>${o.status}</td>
          <td>${new Date(o.createdAt).toLocaleDateString("vi-VN")}</td>
        </tr>
      `).join("");

  } catch (err) {
    Api.report(err, loadRecentOrders);
  }
}

// ===== TOP PRODUCTS =====
async function loadTopProducts() {
  try {
  const res = await Api.admin(window.AppConfig.apiBase + "/admin/top-products"
    , {
    headers: { Authorization: `Bearer ${localStorage.getItem("adminToken")}`}
  }
  );
  const data = Api.list(await res.json());
  dashboardChart("topProductsChart", {
    type: "bar",
    data: {
      labels: data.map(i => i.nameProduct || i._id),
      datasets: [{
        label: "Sold",
        data: data.map(i => i.totalSold)
      }]
    }
  });
  } catch (error) { Api.report(error, loadTopProducts); }
}

// ===== TOP USERS =====
async function loadTopUsers() {
  try {
  const res = await Api.admin(window.AppConfig.apiBase + "/admin/top-users"
    , {
    headers: { Authorization: `Bearer ${localStorage.getItem("adminToken")}` }
  }
  );
  const data = Api.list(await res.json());
  dashboardChart("topUsersChart", {
    type: "bar",
    data: {
      labels: data.map(i => i._id),
      datasets: [{
        label: "Spent",
        data: data.map(i => i.totalSpent)
      }]
    }
  });
  } catch (error) { Api.report(error, loadTopUsers); }
}

loadDashboard();
