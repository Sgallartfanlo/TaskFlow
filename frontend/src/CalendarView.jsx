
import React, { useState } from "react";
import "./calendar.css";

// ==========================================
// CONFIGURACIO DEL CALENDARI
// ==========================================

const MONTHS = [
  "Gener", "Febrer", "Març", "Abril",
  "Maig", "Juny", "Juliol", "Agost",
  "Setembre", "Octubre", "Novembre",
  "Desembre"
];

const WEEKDAYS = [
  "Dl", "Dt", "Dc", "Dj", "Dv", "Ds", "Dg"
];

function dateKey(year, month, day) {
  return (
    `${year}-${String(month + 1).padStart(2, "0")}` +
    `-${String(day).padStart(2, "0")}`
  );
}

function todayKey() {
  const now = new Date();

  return dateKey(
    now.getFullYear(),
    now.getMonth(),
    now.getDate()
  );
}

// ==========================================
// COMPONENT CALENDARI
// ==========================================

export default function CalendarView({
  tasks,
  onEdit
}) {

  const [currentMonth, setCurrentMonth] = useState(
    () => new Date().getMonth()
  );

  const [currentYear, setCurrentYear] = useState(
    () => new Date().getFullYear()
  );

  // ==========================================
  // NAVEGACIO ENTRE MESOS
  // ==========================================

  function changeMonth(direction) {
    const newDate = new Date(
      currentYear,
      currentMonth + direction,
      1
    );

    setCurrentMonth(newDate.getMonth());
    setCurrentYear(newDate.getFullYear());
  }

  function goToday() {
    const now = new Date();

    setCurrentMonth(now.getMonth());
    setCurrentYear(now.getFullYear());
  }

  // ==========================================
  // CALCULAR ELS DIES DEL MES
  // ==========================================

  const firstDay = new Date(
    currentYear,
    currentMonth,
    1
  );

  const daysInMonth = new Date(
    currentYear,
    currentMonth + 1,
    0
  ).getDate();

  // Dilluns = 0, diumenge = 6
  const startOffset = (
    firstDay.getDay() + 6
  ) % 7;

  const totalCells = Math.ceil(
    (startOffset + daysInMonth) / 7
  ) * 7;

  const cells = Array.from(
    { length: totalCells },
    (_, index) => index - startOffset + 1
  );

  // ==========================================
  // TASQUES AMB DATA LIMIT
  // ==========================================

  const datedTasks = tasks.filter(
    task => task.due_date
  );

  const withoutDate = tasks.filter(
    task => !task.due_date
  );

  const today = todayKey();

  function tasksForDay(day) {
    const key = dateKey(
      currentYear,
      currentMonth,
      day
    );

    return datedTasks.filter(
      task => task.due_date === key
    );
  }

  function isOverdue(task) {
    return (
      task.due_date < today &&
      task.status !== "completada"
    );
  }

  // ==========================================
  // INTERFICIE
  // ==========================================

  return (
    <section className="calendar-panel">

      {/* CAPCALERA */}

      <div className="calendar-header">

        <div>
          <h2>📅 Calendari de tasques</h2>
          <p>
            Consulta les dates límit
            i organitza els lliuraments.
          </p>
        </div>

        <div className="calendar-navigation">

          <button
            type="button"
            onClick={() => changeMonth(-1)}
            aria-label="Mes anterior"
          >
            ‹
          </button>

          <button
            type="button"
            className="calendar-today"
            onClick={goToday}
          >
            Avui
          </button>

          <button
            type="button"
            onClick={() => changeMonth(1)}
            aria-label="Mes següent"
          >
            ›
          </button>

        </div>
      </div>

      {/* MES ACTUAL */}

      <h3 className="calendar-month-title">
        {MONTHS[currentMonth]} {currentYear}
      </h3>

      {/* LLEGENDA */}

      <div className="calendar-legend">
        <span className="legend-low">● Baixa</span>
        <span className="legend-medium">● Mitjana</span>
        <span className="legend-high">● Alta</span>
      </div>

      {/* GRAELLA DEL CALENDARI */}

      <div className="calendar-grid">

        {WEEKDAYS.map(day => (
          <div
            key={day}
            className="calendar-weekday"
          >
            {day}
          </div>
        ))}

        {cells.map((day, index) => {

          if (day < 1 || day > daysInMonth) {
            return (
              <div
                key={`empty-${index}`}
                className="calendar-day empty"
              />
            );
          }

          const key = dateKey(
            currentYear,
            currentMonth,
            day
          );

          const dayTasks = tasksForDay(day);

          const isToday = key === today;

          return (
            <div
              key={key}
              className={
                "calendar-day " +
                (isToday ? "calendar-current-day" : "")
              }
            >

              <div className="calendar-day-number">
                <span>{day}</span>

                {dayTasks.length > 0 && (
                  <small>{dayTasks.length}</small>
                )}
              </div>

              <div className="calendar-day-tasks">

                {dayTasks.map(task => (
                  <button
                    key={task.id}
                    type="button"
                    className={
                      "calendar-task priority-" +
                      (task.priority || "mitjana") +
                      (task.status === "completada"
                        ? " calendar-task-done"
                        : "") +
                      (isOverdue(task)
                        ? " calendar-task-overdue"
                        : "")
                    }
                    title={
                      `${task.title}\n` +
                      `Estat: ${task.status}`
                    }
                    onClick={() => onEdit(task)}
                  >
                    {task.status === "completada"
                      ? "✓ "
                      : ""}
                    {task.title}
                  </button>
                ))}

              </div>
            </div>
          );
        })}

      </div>

      {/* TASQUES SENSE DATA */}

      {withoutDate.length > 0 && (
        <div className="calendar-undated">

          <h3>
            🗂️ Tasques sense data límit
            ({withoutDate.length})
          </h3>

          <div className="calendar-undated-list">

            {withoutDate.map(task => (
              <button
                key={task.id}
                type="button"
                onClick={() => onEdit(task)}
              >
                {task.title}
              </button>
            ))}

          </div>
        </div>
      )}

      <p className="calendar-help">
        💡 Fes clic sobre una tasca
        per editar-ne la data, la prioritat
        o l'estat.
      </p>

    </section>
  );
}
