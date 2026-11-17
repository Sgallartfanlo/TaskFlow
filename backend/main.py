import os
import json
import asyncio
import urllib.request
import urllib.error
from calendar import monthrange
import uuid
import zipfile
from pathlib import Path
from contextlib import asynccontextmanager
from datetime import date, datetime, timedelta, timezone
from typing import Literal

import jwt
from fastapi import Depends, FastAPI, File, HTTPException, UploadFile, status
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jwt.exceptions import InvalidTokenError
from pwdlib import PasswordHash
from pydantic import BaseModel, ConfigDict, EmailStr, Field
from sqlalchemy import Boolean, Column, Date, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint, create_engine
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, declarative_base, relationship, sessionmaker

DATABASE_URL = os.environ["DATABASE_URL"]
JWT_SECRET = os.environ["JWT_SECRET"]
JWT_ALGORITHM = "HS256"
TOKEN_MINUTES = 60 * 12
UPLOAD_DIR = Path(os.getenv("UPLOAD_DIR", "/app/uploads"))
MAX_UPLOAD_BYTES = 10 * 1024 * 1024
ALLOWED_EXTENSIONS = {".pdf", ".png", ".jpg", ".jpeg", ".webp", ".txt", ".docx", ".xlsx"}

engine = create_engine(DATABASE_URL, pool_pre_ping=True)
SessionLocal = sessionmaker(bind=engine)
Base = declarative_base()
password_hasher = PasswordHash.recommended()
bearer = HTTPBearer(auto_error=False)

Estado = Literal["pendent", "progres", "completada"]
Prioridad = Literal["baixa", "mitjana", "alta"]
MemberRole = Literal["editor", "lector"]


class User(Base):
    __tablename__ = "users"
    id = Column(Integer, primary_key=True)
    name = Column(String(120), nullable=False)
    email = Column(String(255), nullable=False, unique=True, index=True)
    password_hash = Column(String(500), nullable=False)


class Project(Base):
    __tablename__ = "projects"
    id = Column(Integer, primary_key=True)
    name = Column(String(150), nullable=False)
    # NULL es conserva únicament per a projectes antics fins que s'assigna propietari.
    owner_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    tasks = relationship("Task", back_populates="project", cascade="all, delete-orphan")
    members = relationship("ProjectMember", back_populates="project", cascade="all, delete-orphan")


class ProjectMember(Base):
    __tablename__ = "project_members"
    id = Column(Integer, primary_key=True)
    project_id = Column(Integer, ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    role = Column(String(15), nullable=False, default="editor")
    project = relationship("Project", back_populates="members")
    user = relationship("User")
    __table_args__ = (UniqueConstraint("project_id", "user_id", name="uq_project_member"),)


class Task(Base):
    __tablename__ = "tasks"
    id = Column(Integer, primary_key=True)
    title = Column(String(200), nullable=False)
    description = Column(Text, nullable=True)
    priority = Column(String(10), nullable=False, default="mitjana")
    due_date = Column(Date, nullable=True)
    start_date = Column(Date, nullable=True)
    status = Column(String(30), nullable=False, default="pendent")
    project_id = Column(Integer, ForeignKey("projects.id"), nullable=False)
    assignee_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    project = relationship("Project", back_populates="tasks")
    assignee = relationship("User")


class TaskComment(Base):
    __tablename__ = "task_comments"
    id = Column(Integer, primary_key=True)
    task_id = Column(Integer, ForeignKey("tasks.id", ondelete="CASCADE"), nullable=False)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    content = Column(Text, nullable=False)
    created_at = Column(DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime(timezone=True), nullable=True)
    author = relationship("User")


class TaskAttachment(Base):
    __tablename__ = "task_attachments"
    id = Column(Integer, primary_key=True)
    task_id = Column(Integer, ForeignKey("tasks.id", ondelete="CASCADE"), nullable=False)
    uploaded_by = Column(Integer, ForeignKey("users.id"), nullable=False)
    original_filename = Column(String(255), nullable=False)
    stored_filename = Column(String(255), nullable=False, unique=True)
    content_type = Column(String(150), nullable=False)
    file_size = Column(Integer, nullable=False)
    created_at = Column(DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc))


class Notification(Base):
    __tablename__ = "notifications"
    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    project_id = Column(Integer, ForeignKey("projects.id", ondelete="CASCADE"), nullable=True)
    task_id = Column(Integer, ForeignKey("tasks.id", ondelete="SET NULL"), nullable=True)
    type = Column(String(50), nullable=False)
    title = Column(String(200), nullable=False)
    message = Column(Text, nullable=False)
    is_read = Column(Boolean, nullable=False, default=False)
    created_at = Column(DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc))


class NotificationOut(BaseModel):
    id: int
    user_id: int
    project_id: int | None
    task_id: int | None
    type: str
    title: str
    message: str
    is_read: bool
    created_at: datetime
    model_config = ConfigDict(from_attributes=True)


class NotificationCountOut(BaseModel):
    unread: int


class RegisterInput(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)


class LoginInput(BaseModel):
    email: EmailStr
    password: str


class UserOut(BaseModel):
    id: int
    name: str
    email: EmailStr
    model_config = ConfigDict(from_attributes=True)


class AuthOut(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserOut


class ProjectCreate(BaseModel):
    name: str = Field(min_length=1, max_length=150)


class ProjectOut(BaseModel):
    id: int
    name: str
    owner_id: int | None
    role: str


class MemberAdd(BaseModel):
    email: EmailStr
    role: MemberRole = "editor"


class MemberRoleUpdate(BaseModel):
    role: MemberRole


class MemberOut(BaseModel):
    user_id: int
    name: str
    email: str
    role: str


class TaskCreate(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    project_id: int
    description: str | None = None
    priority: Prioridad = "mitjana"
    due_date: date | None = None
    start_date: date | None = None
    status: Estado = "pendent"
    assignee_id: int | None = None


class TaskUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = None
    priority: Prioridad | None = None
    due_date: date | None = None
    start_date: date | None = None
    status: Estado | None = None
    assignee_id: int | None = None


class CommentCreate(BaseModel):
    content: str = Field(min_length=1, max_length=5000)


class CommentUpdate(BaseModel):
    content: str = Field(min_length=1, max_length=5000)


class CommentOut(BaseModel):
    id: int
    task_id: int
    user_id: int
    author_name: str
    content: str
    created_at: datetime
    updated_at: datetime | None


class AttachmentOut(BaseModel):
    id: int
    task_id: int
    uploaded_by: int
    uploader_name: str
    original_filename: str
    content_type: str
    file_size: int
    created_at: datetime


class TaskOut(BaseModel):
    id: int
    title: str
    description: str | None
    priority: Prioridad
    due_date: date | None
    start_date: date | None
    status: Estado
    project_id: int
    assignee_id: int | None
    assignee_name: str | None


def get_db():
    with SessionLocal() as db:
        yield db


def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer),
    db: Session = Depends(get_db),
) -> User:
    unauthorized = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Sessió no vàlida o caducada",
        headers={"WWW-Authenticate": "Bearer"},
    )
    if credentials is None or credentials.scheme.lower() != "bearer":
        raise unauthorized
    try:
        payload = jwt.decode(credentials.credentials, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        user_id = int(payload["sub"])
    except (InvalidTokenError, KeyError, ValueError, TypeError):
        raise unauthorized
    user = db.get(User, user_id)
    if user is None:
        raise unauthorized
    return user


def require_member(
    db: Session, project_id: int, user: User,
    owner_only: bool = False, edit_required: bool = False,
) -> ProjectMember:
    membership = db.query(ProjectMember).filter_by(project_id=project_id, user_id=user.id).first()
    if membership is None:
        # No revelem si el projecte existeix.
        raise HTTPException(404, "Projecte no trobat")
    if owner_only and membership.role != "owner":
        raise HTTPException(403, "Només el propietari pot fer aquesta acció")
    if edit_required and membership.role not in ("owner", "editor"):
        raise HTTPException(403, "El rol lector només permet consultar")
    return membership


def require_task(db: Session, task_id: int, user: User, edit_required: bool = False) -> Task:
    task = db.get(Task, task_id)
    if task is None:
        raise HTTPException(404, "Tasca no trobada")
    require_member(db, task.project_id, user, edit_required=edit_required)
    return task


def verify_assignee(db: Session, project_id: int, assignee_id: int | None) -> None:
    if assignee_id is None:
        return
    member = db.query(ProjectMember).filter_by(project_id=project_id, user_id=assignee_id).first()
    if member is None:
        raise HTTPException(400, "La persona assignada ha de pertànyer al projecte")


def task_out(task: Task, db: Session) -> TaskOut:
    assignee = db.get(User, task.assignee_id) if task.assignee_id is not None else None
    return TaskOut(
        id=task.id, title=task.title, description=task.description,
        priority=task.priority, due_date=task.due_date, start_date=task.start_date, status=task.status,
        project_id=task.project_id, assignee_id=task.assignee_id,
        assignee_name=assignee.name if assignee else None,
    )


def comment_out(comment: TaskComment, db: Session) -> CommentOut:
    author = db.get(User, comment.user_id)
    return CommentOut(
        id=comment.id, task_id=comment.task_id, user_id=comment.user_id,
        author_name=author.name if author else "Usuari eliminat",
        content=comment.content, created_at=comment.created_at,
        updated_at=comment.updated_at,
    )


def attachment_out(attachment: TaskAttachment, db: Session) -> AttachmentOut:
    author = db.get(User, attachment.uploaded_by)
    return AttachmentOut(
        id=attachment.id, task_id=attachment.task_id,
        uploaded_by=attachment.uploaded_by,
        uploader_name=author.name if author else "Usuari desconegut",
        original_filename=attachment.original_filename,
        content_type=attachment.content_type, file_size=attachment.file_size,
        created_at=attachment.created_at,
    )


def validate_uploaded_file(path: Path, extension: str) -> str:
    """Comprova les signatures de fitxer i els formats Office ZIP."""
    with path.open("rb") as stream:
        header = stream.read(16)
    if extension == ".pdf" and header.startswith(b"%PDF-"):
        return "application/pdf"
    if extension == ".png" and header.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if extension in (".jpg", ".jpeg") and header.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if extension == ".webp" and header.startswith(b"RIFF") and header[8:12] == b"WEBP":
        return "image/webp"
    if extension == ".txt":
        try:
            path.read_text(encoding="utf-8")
        except UnicodeError:
            raise HTTPException(400, "El fitxer TXT ha de ser UTF-8")
        return "text/plain; charset=utf-8"
    if extension in (".docx", ".xlsx"):
        try:
            with zipfile.ZipFile(path) as archive:
                names = archive.namelist()
                if len(names) > 10000 or not archive.testzip() is None:
                    raise ValueError("Arxiu Office invàlid")
                marker = "word/document.xml" if extension == ".docx" else "xl/workbook.xml"
                if marker not in names or "[Content_Types].xml" not in names:
                    raise ValueError("El format Office no coincideix")
        except (OSError, zipfile.BadZipFile, ValueError, RuntimeError):
            raise HTTPException(400, "Document Office invàlid")
        return ("application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                if extension == ".docx" else
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
    raise HTTPException(400, "El contingut del fitxer no coincideix amb l'extensió")


def cleaned_comment(content: str) -> str:
    content = content.strip()
    if not content:
        raise HTTPException(400, "El comentari no pot estar buit")
    return content


def queue_notification(
    db: Session, *, user_id: int, type: str, title: str, message: str,
    project_id: int | None = None, task_id: int | None = None,
) -> None:
    # S'afegeix a la mateixa transaccio que l'accio que l'ha originada.
    db.add(Notification(
        user_id=user_id, type=type, title=title,
        message=message, project_id=project_id, task_id=task_id,
    ))


def generate_due_notifications(db: Session, user: User) -> None:
    """Crea avisos de venciment quan l'usuari consulta les notificacions.

    No requereix un procés en segon pla. Una tasca només genera un avís
    per data límit; modificar la data pot generar un nou avís.
    """
    today = datetime.now().astimezone().date()
    limit = today + timedelta(days=2)
    tasks = (
        db.query(Task)
        .join(ProjectMember, ProjectMember.project_id == Task.project_id)
        .filter(
            ProjectMember.user_id == user.id,
            Task.assignee_id == user.id,
            Task.status != "completada",
            Task.due_date >= today,
            Task.due_date <= limit,
        )
        .all()
    )
    added = False
    for task in tasks:
        # La data forma part del missatge i permet distingir reprogramacions.
        message = f"La tasca '{task.title}' venç el {task.due_date.isoformat()}."
        exists = db.query(Notification.id).filter_by(
            user_id=user.id, task_id=task.id,
            type="venciment", message=message,
        ).first()
        if exists:
            continue
        queue_notification(
            db, user_id=user.id, type="venciment",
            title="Data límit propera", message=message,
            project_id=task.project_id, task_id=task.id,
        )
        added = True
    if added:
        db.commit()


def create_token(user_id: int) -> str:
    expires = datetime.now(timezone.utc) + timedelta(minutes=TOKEN_MINUTES)
    return jwt.encode({"sub": str(user_id), "exp": expires}, JWT_SECRET, algorithm=JWT_ALGORITHM)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Per a instal·lacions antigues cal executar migrations/001_multiuser.sql primer.
    Base.metadata.create_all(bind=engine)
    yield


app = FastAPI(title="TaskFlow API", version="3.0.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/")
def home():
    return {"message": "TaskFlow API operativa", "version": "3.0.0"}


@app.post("/auth/register", response_model=AuthOut, status_code=201)
def register(data: RegisterInput, db: Session = Depends(get_db)):
    name = data.name.strip()
    if not name:
        raise HTTPException(400, "El nom no pot estar buit")
    email = str(data.email).strip().lower()
    if db.query(User).filter_by(email=email).first():
        raise HTTPException(409, "Ja existeix un compte amb aquest correu")
    user = User(name=name, email=email, password_hash=password_hasher.hash(data.password))
    db.add(user)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "Ja existeix un compte amb aquest correu")
    db.refresh(user)
    return AuthOut(access_token=create_token(user.id), user=UserOut.model_validate(user))


@app.post("/auth/login", response_model=AuthOut)
def login(data: LoginInput, db: Session = Depends(get_db)):
    user = db.query(User).filter_by(email=str(data.email).strip().lower()).first()
    if not user or not password_hasher.verify(data.password, user.password_hash):
        raise HTTPException(401, "Correu o contrasenya incorrectes")
    return AuthOut(access_token=create_token(user.id), user=UserOut.model_validate(user))


@app.get("/auth/me", response_model=UserOut)
def me(user: User = Depends(get_current_user)):
    return user


@app.get("/projects", response_model=list[ProjectOut])
def get_projects(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    rows = (
        db.query(Project, ProjectMember)
        .join(ProjectMember, ProjectMember.project_id == Project.id)
        .filter(ProjectMember.user_id == user.id)
        .order_by(Project.id)
        .all()
    )
    return [ProjectOut(id=p.id, name=p.name, owner_id=p.owner_id, role=m.role) for p, m in rows]


@app.post("/projects", response_model=ProjectOut, status_code=201)
def create_project(
    data: ProjectCreate, db: Session = Depends(get_db), user: User = Depends(get_current_user)
):
    name = data.name.strip()
    if not name:
        raise HTTPException(400, "El nom no pot estar buit")
    project = Project(name=name, owner_id=user.id)
    db.add(project)
    db.flush()
    log_activity(db, project.id, user.id, "project_created", f"Projecte creat: {project.name}")
    db.add(ProjectMember(project_id=project.id, user_id=user.id, role="owner"))
    db.commit()
    db.refresh(project)
    return ProjectOut(id=project.id, name=project.name, owner_id=user.id, role="owner")


@app.delete("/projects/{project_id}")
def delete_project(
    project_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)
):
    require_member(db, project_id, user, owner_only=True)
    project = db.get(Project, project_id)
    db.delete(project)
    db.commit()
    return {"message": "Projecte eliminat"}


@app.get("/projects/{project_id}/members", response_model=list[MemberOut])
def list_members(
    project_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)
):
    require_member(db, project_id, user)
    rows = (
        db.query(ProjectMember, User)
        .join(User, User.id == ProjectMember.user_id)
        .filter(ProjectMember.project_id == project_id)
        .order_by(User.name)
        .all()
    )
    return [MemberOut(user_id=u.id, name=u.name, email=u.email, role=m.role) for m, u in rows]


@app.post("/projects/{project_id}/members", response_model=MemberOut, status_code=201)
def add_member(
    project_id: int, data: MemberAdd, db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    require_member(db, project_id, user, owner_only=True)
    target = db.query(User).filter_by(email=str(data.email).strip().lower()).first()
    if target is None:
        raise HTTPException(404, "Aquest correu encara no té un compte registrat")
    existing = db.query(ProjectMember).filter_by(project_id=project_id, user_id=target.id).first()
    if existing:
        raise HTTPException(409, "Aquesta persona ja és membre del projecte")
    membership = ProjectMember(project_id=project_id, user_id=target.id, role=data.role)
    db.add(membership)
    log_activity(db, project_id, user.id, "member_added", f"Membre convidat: {target.name}")
    queue_notification(
        db, user_id=target.id, type="projecte_compartit",
        title="T'han compartit un projecte",
        message=f"{user.name} t'ha afegit al projecte com a {data.role}.",
        project_id=project_id,
    )
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "Aquesta persona ja és membre del projecte")
    return MemberOut(user_id=target.id, name=target.name, email=target.email, role=membership.role)


@app.patch("/projects/{project_id}/members/{member_user_id}", response_model=MemberOut)
def change_member_role(
    project_id: int, member_user_id: int, data: MemberRoleUpdate,
    db: Session = Depends(get_db), user: User = Depends(get_current_user),
):
    require_member(db, project_id, user, owner_only=True)
    membership = db.query(ProjectMember).filter_by(
        project_id=project_id, user_id=member_user_id
    ).first()
    if membership is None:
        raise HTTPException(404, "Membre no trobat")
    if membership.role == "owner":
        raise HTTPException(400, "No es pot canviar el rol del propietari")
    membership.role = data.role
    log_activity(db, project_id, user.id, "member_role", f"Rol de {member_user_id} canviat a {data.role}")
    db.commit()
    target = db.get(User, member_user_id)
    return MemberOut(
        user_id=target.id, name=target.name,
        email=target.email, role=membership.role,
    )


@app.delete("/projects/{project_id}/members/{member_user_id}")
def remove_member(
    project_id: int, member_user_id: int, db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    require_member(db, project_id, user, owner_only=True)
    member = db.query(ProjectMember).filter_by(project_id=project_id, user_id=member_user_id).first()
    if not member:
        raise HTTPException(404, "Membre no trobat")
    if member.role == "owner":
        raise HTTPException(400, "No es pot eliminar el propietari")
    # Desassignem les tasques d'aquesta persona, que deixarà de tenir accés.
    db.query(Task).filter_by(project_id=project_id, assignee_id=member_user_id).update(
        {Task.assignee_id: None}, synchronize_session=False
    )
    db.delete(member)
    log_activity(db, project_id, user.id, "member_removed", f"Accés revocat a usuari {member_user_id}")
    db.commit()
    return {"message": "Accés revocat"}


@app.get("/tasks", response_model=list[TaskOut])
def get_tasks(
    project_id: int | None = None,
    db: Session = Depends(get_db), user: User = Depends(get_current_user),
):
    query = (
        db.query(Task)
        .join(ProjectMember, ProjectMember.project_id == Task.project_id)
        .filter(ProjectMember.user_id == user.id)
    )
    if project_id is not None:
        require_member(db, project_id, user)
        query = query.filter(Task.project_id == project_id)
    return [task_out(task, db) for task in query.order_by(Task.id).all()]


@app.post("/tasks", response_model=TaskOut, status_code=201)
def create_task(
    data: TaskCreate, db: Session = Depends(get_db), user: User = Depends(get_current_user)
):
    require_member(db, data.project_id, user, edit_required=True)
    verify_assignee(db, data.project_id, data.assignee_id)
    title = data.title.strip()
    if not title:
        raise HTTPException(400, "El títol no pot estar buit")
    task = Task(
        title=title, description=data.description, priority=data.priority,
        due_date=data.due_date, start_date=data.start_date, status=data.status, project_id=data.project_id,
        assignee_id=data.assignee_id,
    )
    db.add(task)
    db.flush()
    log_activity(db, task.project_id, user.id, "task_created", f"Tasca creada: {task.title}", task.id)
    if task.assignee_id is not None and task.assignee_id != user.id:
        queue_notification(
            db, user_id=task.assignee_id, type="tasca_assignada",
            title="T'han assignat una tasca",
            message=f"{user.name} t'ha assignat la tasca '{task.title}'.",
            project_id=task.project_id, task_id=task.id,
        )
    db.commit()
    db.refresh(task)
    return task_out(task, db)


@app.patch("/tasks/{task_id}", response_model=TaskOut)
def update_task(
    task_id: int, data: TaskUpdate,
    db: Session = Depends(get_db), user: User = Depends(get_current_user),
):
    task = require_task(db, task_id, user, edit_required=True)
    changes = data.model_dump(exclude_unset=True)
    if "title" in changes:
        title = changes["title"]
        if title is None or not title.strip():
            raise HTTPException(400, "El títol no pot estar buit")
        changes["title"] = title.strip()
    for key in ("priority", "status"):
        if key in changes and changes[key] is None:
            raise HTTPException(400, f"El camp {key} no pot ser nul")
    if "assignee_id" in changes:
        verify_assignee(db, task.project_id, changes["assignee_id"])

    old_assignee = task.assignee_id
    old_status = task.status
    for key, value in changes.items():
        setattr(task, key, value)
    if changes:
        log_activity(db, task.project_id, user.id, "task_updated", f"Actualitzada {task.title}: {', '.join(sorted(changes.keys()))}", task.id)

    if task.assignee_id is not None and task.assignee_id != old_assignee and task.assignee_id != user.id:
        queue_notification(
            db, user_id=task.assignee_id, type="tasca_assignada",
            title="T'han assignat una tasca",
            message=f"{user.name} t'ha assignat la tasca '{task.title}'.",
            project_id=task.project_id, task_id=task.id,
        )
    if old_status != task.status and task.assignee_id is not None and task.assignee_id != user.id:
        queue_notification(
            db, user_id=task.assignee_id, type="canvi_estat",
            title="Estat de tasca actualitzat",
            message=f"{user.name} ha canviat '{task.title}' de {old_status} a {task.status}.",
            project_id=task.project_id, task_id=task.id,
        )
    db.commit()
    db.refresh(task)
    return task_out(task, db)


@app.delete("/tasks/{task_id}")
def delete_task(
    task_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)
):
    task = require_task(db, task_id, user, edit_required=True)
    log_activity(db, task.project_id, user.id, "task_deleted", f"Tasca eliminada: {task.title}")
    db.delete(task)
    db.commit()
    return {"message": "Tasca eliminada"}


# ==========================================
# COMENTARIS A LES TASQUES (TASKFLOW 2.9)
# ==========================================

@app.get("/tasks/{task_id}/comments", response_model=list[CommentOut])
def list_task_comments(
    task_id: int, db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    # Els rols owner, editor i lector poden consultar els comentaris.
    require_task(db, task_id, user)
    comments = (
        db.query(TaskComment)
        .filter(TaskComment.task_id == task_id)
        .order_by(TaskComment.created_at, TaskComment.id)
        .all()
    )
    return [comment_out(comment, db) for comment in comments]


@app.post("/tasks/{task_id}/comments", response_model=CommentOut, status_code=201)
def create_task_comment(
    task_id: int, data: CommentCreate,
    db: Session = Depends(get_db), user: User = Depends(get_current_user),
):
    # Només owner/editor poden comentar.
    task = require_task(db, task_id, user, edit_required=True)
    content = cleaned_comment(data.content)

    # Avisem els membres que ja participaven en la conversa i la persona
    # assignada, sempre que continuïn tenint accés al projecte.
    participant_ids = {
        row[0] for row in db.query(TaskComment.user_id)
        .filter(TaskComment.task_id == task_id).distinct().all()
    }
    if task.assignee_id is not None:
        participant_ids.add(task.assignee_id)
    participant_ids.discard(user.id)
    permitted_ids = {
        row[0] for row in db.query(ProjectMember.user_id)
        .filter(ProjectMember.project_id == task.project_id,
                ProjectMember.user_id.in_(participant_ids)).all()
    } if participant_ids else set()

    comment = TaskComment(task_id=task_id, user_id=user.id, content=content)
    db.add(comment)
    log_activity(db, task.project_id, user.id, "comment_created", f"Comentari a {task.title}", task.id)
    db.flush()
    for recipient_id in permitted_ids:
        queue_notification(
            db, user_id=recipient_id, type="comentari_tasca",
            title="Nou comentari en una tasca",
            message=f"{user.name} ha comentat la tasca '{task.title}'.",
            project_id=task.project_id, task_id=task.id,
        )
    db.commit()
    db.refresh(comment)
    return comment_out(comment, db)


@app.patch("/tasks/{task_id}/comments/{comment_id}", response_model=CommentOut)
def update_task_comment(
    task_id: int, comment_id: int, data: CommentUpdate,
    db: Session = Depends(get_db), user: User = Depends(get_current_user),
):
    require_task(db, task_id, user, edit_required=True)
    comment = db.query(TaskComment).filter_by(id=comment_id, task_id=task_id).first()
    if comment is None:
        raise HTTPException(404, "Comentari no trobat")
    if comment.user_id != user.id:
        raise HTTPException(403, "Només pots editar els teus comentaris")
    comment.content = cleaned_comment(data.content)
    comment.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(comment)
    return comment_out(comment, db)


@app.delete("/tasks/{task_id}/comments/{comment_id}")
def delete_task_comment(
    task_id: int, comment_id: int,
    db: Session = Depends(get_db), user: User = Depends(get_current_user),
):
    task = require_task(db, task_id, user, edit_required=True)
    comment = db.query(TaskComment).filter_by(id=comment_id, task_id=task_id).first()
    if comment is None:
        raise HTTPException(404, "Comentari no trobat")
    membership = require_member(db, task.project_id, user)
    if comment.user_id != user.id and membership.role != "owner":
        raise HTTPException(403, "Només pots eliminar els teus comentaris")
    db.delete(comment)
    db.commit()
    return {"message": "Comentari eliminat"}


# ==========================================
# ADJUNTS A LES TASQUES (TASKFLOW 2.9)
# ==========================================

@app.get("/tasks/{task_id}/attachments", response_model=list[AttachmentOut])
def list_task_attachments(
    task_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user),
):
    # Tots els membres del projecte, inclosos els lectors, poden consultar.
    require_task(db, task_id, user)
    attachments = (db.query(TaskAttachment)
                   .filter(TaskAttachment.task_id == task_id)
                   .order_by(TaskAttachment.created_at.desc(), TaskAttachment.id.desc()).all())
    return [attachment_out(item, db) for item in attachments]


@app.post("/tasks/{task_id}/attachments", response_model=AttachmentOut, status_code=201)
async def upload_task_attachment(
    task_id: int, file: UploadFile = File(...),
    db: Session = Depends(get_db), user: User = Depends(get_current_user),
):
    require_task(db, task_id, user, edit_required=True)
    # El nom d'arxiu és només metadada: mai s'utilitza com a ruta de desament.
    original = (file.filename or "").replace("\\", "/").split("/")[-1].strip()
    if not original or len(original) > 255 or original in (".", ".."):
        raise HTTPException(400, "Nom de fitxer invàlid o massa llarg")
    extension = Path(original).suffix.lower()
    if extension not in ALLOWED_EXTENSIONS:
        raise HTTPException(400, "Format no permès. Admesos: PDF, PNG, JPG, WEBP, TXT, DOCX, XLSX")

    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    stored_name = f"{uuid.uuid4().hex}{extension}"
    destination = UPLOAD_DIR / stored_name
    size = 0
    try:
        with destination.open("xb") as stream:
            while chunk := await file.read(1024 * 1024):
                size += len(chunk)
                if size > MAX_UPLOAD_BYTES:
                    raise HTTPException(413, "Mida màxima permesa: 10 MB")
                stream.write(chunk)
        if size == 0:
            raise HTTPException(400, "No es poden adjuntar fitxers buits")
        detected_type = validate_uploaded_file(destination, extension)
        attachment = TaskAttachment(
            task_id=task_id, uploaded_by=user.id,
            original_filename=original, stored_filename=stored_name,
            content_type=detected_type, file_size=size,
        )
        db.add(attachment)
        task = db.get(Task, task_id)
        log_activity(db, task.project_id, user.id, "attachment_added", f"Adjunt: {original}", task.id)
        db.commit()
        db.refresh(attachment)
        return attachment_out(attachment, db)
    except Exception:
        db.rollback()
        destination.unlink(missing_ok=True)
        raise
    finally:
        await file.close()


@app.get("/tasks/{task_id}/attachments/{attachment_id}/download")
def download_task_attachment(
    task_id: int, attachment_id: int,
    db: Session = Depends(get_db), user: User = Depends(get_current_user),
):
    require_task(db, task_id, user)
    attachment = db.query(TaskAttachment).filter_by(id=attachment_id, task_id=task_id).first()
    if attachment is None:
        raise HTTPException(404, "Adjunt no trobat")
    stored_path = UPLOAD_DIR / attachment.stored_filename
    if not stored_path.is_file():
        raise HTTPException(404, "El fitxer físic no està disponible")
    return FileResponse(
        stored_path, filename=attachment.original_filename,
        media_type="application/octet-stream", content_disposition_type="attachment",
    )


@app.delete("/tasks/{task_id}/attachments/{attachment_id}")
def delete_task_attachment(
    task_id: int, attachment_id: int,
    db: Session = Depends(get_db), user: User = Depends(get_current_user),
):
    task = require_task(db, task_id, user, edit_required=True)
    attachment = db.query(TaskAttachment).filter_by(id=attachment_id, task_id=task_id).first()
    if attachment is None:
        raise HTTPException(404, "Adjunt no trobat")
    membership = require_member(db, task.project_id, user)
    if attachment.uploaded_by != user.id and membership.role != "owner":
        raise HTTPException(403, "Només pots eliminar els teus adjunts")
    stored_path = UPLOAD_DIR / attachment.stored_filename
    db.delete(attachment)
    db.commit()
    # La BD és la font de veritat; un error d'esborrat físic no exposa el fitxer.
    try:
        stored_path.unlink(missing_ok=True)
    except OSError:
        pass
    return {"message": "Adjunt eliminat"}


# ==========================================
# NOTIFICACIONS (TASKFLOW 2.8)
# ==========================================

@app.get("/notifications", response_model=list[NotificationOut])
def list_notifications(
    unread_only: bool = False, limit: int = 50,
    db: Session = Depends(get_db), user: User = Depends(get_current_user),
):
    generate_due_notifications(db, user)
    query = db.query(Notification).filter(Notification.user_id == user.id)
    if unread_only:
        query = query.filter(Notification.is_read.is_(False))
    limit = min(max(limit, 1), 100)
    return query.order_by(Notification.created_at.desc(), Notification.id.desc()).limit(limit).all()


@app.get("/notifications/unread-count", response_model=NotificationCountOut)
def unread_count(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    generate_due_notifications(db, user)
    count = db.query(Notification).filter_by(user_id=user.id, is_read=False).count()
    return NotificationCountOut(unread=count)


@app.patch("/notifications/{notification_id}/read", response_model=NotificationOut)
def mark_notification_read(
    notification_id: int,
    db: Session = Depends(get_db), user: User = Depends(get_current_user),
):
    notification = db.query(Notification).filter_by(
        id=notification_id, user_id=user.id
    ).first()
    if not notification:
        raise HTTPException(404, "Notificació no trobada")
    notification.is_read = True
    db.commit()
    db.refresh(notification)
    return notification


@app.patch("/notifications/read-all")
def mark_all_notifications_read(
    db: Session = Depends(get_db), user: User = Depends(get_current_user),
):
    # Generem primer avisos propers perquè el botó 'tot llegit' els inclogui.
    generate_due_notifications(db, user)
    changed = db.query(Notification).filter_by(user_id=user.id, is_read=False).update(
        {Notification.is_read: True}, synchronize_session=False
    )
    db.commit()
    return {"message": "Notificacions marcades com a llegides", "updated": changed}

# ==========================================
# ESTADÍSTIQUES DEL PROJECTE (TASKFLOW 2.9)
# ==========================================

@app.get("/projects/{project_id}/stats")
def get_project_stats(
    project_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Resum de l'estat actual del projecte, accessible a tots els seus membres.

    Les tasques no tenen data de creació/compleció; per tant, no es presenta
    cap sèrie històrica de productivitat. Els agrupaments mensuals fan
    referència a les dates límit, no a quan es van completar tasques.
    """
    require_member(db, project_id, user)
    project = db.get(Project, project_id)
    tasks = db.query(Task).filter(Task.project_id == project_id).all()

    today = datetime.now().astimezone().date()
    next_week = today + timedelta(days=7)
    statuses = {"pendent": 0, "progres": 0, "completada": 0}
    priorities = {"baixa": 0, "mitjana": 0, "alta": 0}
    due = {"overdue": 0, "due_today": 0, "next_7_days": 0, "future": 0,
           "no_due_date": 0, "completed": 0}

    rows = (
        db.query(ProjectMember, User)
        .join(User, User.id == ProjectMember.user_id)
        .filter(ProjectMember.project_id == project_id)
        .order_by(User.name, User.id)
        .all()
    )
    by_person = {
        u.id: {
            "user_id": u.id, "name": u.name, "role": m.role,
            "total": 0, "pendent": 0, "progres": 0, "completada": 0,
        }
        for m, u in rows
    }
    unassigned = {"user_id": None, "name": "Sense assignar", "role": None,
                  "total": 0, "pendent": 0, "progres": 0, "completada": 0}
    by_month = {}

    for task in tasks:
        if task.status in statuses:
            statuses[task.status] += 1
        if task.priority in priorities:
            priorities[task.priority] += 1

        person = by_person.get(task.assignee_id, unassigned)
        person["total"] += 1
        if task.status in statuses:
            person[task.status] += 1

        if task.due_date:
            month = task.due_date.strftime("%Y-%m")
            bucket = by_month.setdefault(month, {"month": month, "total": 0,
                                                 "completed": 0})
            bucket["total"] += 1
            if task.status == "completada":
                bucket["completed"] += 1

        if task.status == "completada":
            due["completed"] += 1
        elif task.due_date is None:
            due["no_due_date"] += 1
        elif task.due_date < today:
            due["overdue"] += 1
        elif task.due_date == today:
            due["due_today"] += 1
        elif task.due_date <= next_week:
            due["next_7_days"] += 1
        else:
            due["future"] += 1

    total = len(tasks)
    completed = statuses["completada"]
    return {
        "project_id": project_id,
        "project_name": project.name,
        "as_of": today.isoformat(),
        "summary": {
            "total": total,
            "completed": completed,
            "completion_percentage": round(completed * 100 / total, 1) if total else 0.0,
        },
        "by_status": statuses,
        "by_priority": priorities,
        "by_assignee": list(by_person.values()) + ([unassigned] if unassigned["total"] else []),
        "due_dates": due,
        "due_by_month": [by_month[key] for key in sorted(by_month)],
        "note": "Les dades mensuals són per data límit, no un historial de productivitat.",
    }

# ============================================================
# TASKFLOW 3.0: subtasques, checklist, dependències, historial,
# recurrència, cerca global i assistent IA opcional.
# ============================================================
from sqlalchemy import CheckConstraint
from fastapi import Query


class Subtask(Base):
    __tablename__ = "subtasks"
    id = Column(Integer, primary_key=True)
    task_id = Column(Integer, ForeignKey("tasks.id", ondelete="CASCADE"), nullable=False)
    title = Column(String(200), nullable=False)
    is_done = Column(Boolean, nullable=False, default=False)
    assignee_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    position = Column(Integer, nullable=False, default=0)
    created_at = Column(DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc))


class TaskDependency(Base):
    __tablename__ = "task_dependencies"
    task_id = Column(Integer, ForeignKey("tasks.id", ondelete="CASCADE"), primary_key=True)
    depends_on_id = Column(Integer, ForeignKey("tasks.id", ondelete="CASCADE"), primary_key=True)
    __table_args__ = (CheckConstraint("task_id <> depends_on_id", name="chk_distinct_tasks"),)


class ActivityLog(Base):
    __tablename__ = "activity_logs"
    id = Column(Integer, primary_key=True)
    project_id = Column(Integer, ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
    task_id = Column(Integer, ForeignKey("tasks.id", ondelete="SET NULL"), nullable=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    action = Column(String(60), nullable=False)
    description = Column(String(500), nullable=False)
    created_at = Column(DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc))


class RecurrenceRule(Base):
    __tablename__ = "recurrence_rules"
    id = Column(Integer, primary_key=True)
    project_id = Column(Integer, ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
    created_by = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    title = Column(String(200), nullable=False)
    frequency = Column(String(10), nullable=False)
    next_run = Column(Date, nullable=False)
    priority = Column(String(10), nullable=False, default="mitjana")
    assignee_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    enabled = Column(Boolean, nullable=False, default=True)
    created_at = Column(DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc))


class RecurrenceRun(Base):
    __tablename__ = "recurrence_runs"
    id = Column(Integer, primary_key=True)
    rule_id = Column(Integer, ForeignKey("recurrence_rules.id", ondelete="CASCADE"), nullable=False)
    scheduled_for = Column(Date, nullable=False)
    task_id = Column(Integer, ForeignKey("tasks.id", ondelete="SET NULL"), nullable=True)
    __table_args__ = (UniqueConstraint("rule_id", "scheduled_for", name="uq_recurrence_occurrence"),)


def log_activity(db, project_id, user_id, action, description, task_id=None):
    db.add(ActivityLog(project_id=project_id, user_id=user_id,
                       action=action, description=description[:500], task_id=task_id))


class SubtaskInput(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    assignee_id: int | None = None


class SubtaskPatch(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    is_done: bool | None = None
    assignee_id: int | None = None


class DependencyInput(BaseModel):
    depends_on_id: int


class RecurrenceInput(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    frequency: Literal["daily", "weekly", "monthly"]
    next_run: date
    priority: Prioridad = "mitjana"
    assignee_id: int | None = None


class RecurrencePatch(BaseModel):
    enabled: bool


class AIInput(BaseModel):
    prompt: str = Field(min_length=3, max_length=1200)
    action: Literal["suggest_subtasks", "summarize_project", "risk_review"]


def subtask_dict(st, db):
    u = db.get(User, st.assignee_id) if st.assignee_id else None
    return {"id": st.id, "task_id": st.task_id, "title": st.title,
            "is_done": st.is_done, "assignee_id": st.assignee_id,
            "assignee_name": u.name if u else None, "position": st.position}


@app.get("/tasks/{task_id}/subtasks")
def list_subtasks(task_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    require_task(db, task_id, user)
    return [subtask_dict(st, db) for st in db.query(Subtask).filter_by(task_id=task_id)
            .order_by(Subtask.position, Subtask.id).all()]


@app.post("/tasks/{task_id}/subtasks", status_code=201)
def create_subtask(task_id: int, data: SubtaskInput, db: Session = Depends(get_db),
                   user: User = Depends(get_current_user)):
    task = require_task(db, task_id, user, edit_required=True)
    verify_assignee(db, task.project_id, data.assignee_id)
    title = data.title.strip()
    if not title:
        raise HTTPException(400, "El títol no pot estar buit")
    position = db.query(Subtask).filter_by(task_id=task_id).count()
    st = Subtask(task_id=task_id, title=title, assignee_id=data.assignee_id, position=position)
    db.add(st)
    log_activity(db, task.project_id, user.id, "subtask_created", f"Subtasca: {title}", task_id)
    db.commit()
    db.refresh(st)
    return subtask_dict(st, db)


@app.patch("/tasks/{task_id}/subtasks/{subtask_id}")
def patch_subtask(task_id: int, subtask_id: int, data: SubtaskPatch,
                  db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    task = require_task(db, task_id, user, edit_required=True)
    st = db.query(Subtask).filter_by(task_id=task_id, id=subtask_id).first()
    if not st:
        raise HTTPException(404, "Subtasca no trobada")
    changes = data.model_dump(exclude_unset=True)
    if "title" in changes:
        if not changes["title"] or not changes["title"].strip():
            raise HTTPException(400, "El títol no pot estar buit")
        changes["title"] = changes["title"].strip()
    if "assignee_id" in changes:
        verify_assignee(db, task.project_id, changes["assignee_id"])
    for key, val in changes.items():
        setattr(st, key, val)
    if changes:
        log_activity(db, task.project_id, user.id, "subtask_updated", f"Subtasca: {st.title}", task_id)
    db.commit()
    return subtask_dict(st, db)


@app.delete("/tasks/{task_id}/subtasks/{subtask_id}")
def delete_subtask(task_id: int, subtask_id: int, db: Session = Depends(get_db),
                   user: User = Depends(get_current_user)):
    task = require_task(db, task_id, user, edit_required=True)
    st = db.query(Subtask).filter_by(task_id=task_id, id=subtask_id).first()
    if not st:
        raise HTTPException(404, "Subtasca no trobada")
    log_activity(db, task.project_id, user.id, "subtask_deleted", f"Subtasca eliminada: {st.title}", task_id)
    db.delete(st)
    db.commit()
    return {"message": "Subtasca eliminada"}


def has_dependency_path(db, origin, destination):
    """Cerca de camins dirigits iterativa; evita dependències circulars."""
    edges = db.query(TaskDependency.task_id, TaskDependency.depends_on_id).all()
    graph = {}
    for src, dest in edges:
        graph.setdefault(src, set()).add(dest)
    seen, stack = set(), [origin]
    while stack:
        cur = stack.pop()
        if cur == destination:
            return True
        if cur in seen:
            continue
        seen.add(cur)
        stack.extend(graph.get(cur, set()) - seen)
    return False


@app.get("/projects/{project_id}/gantt")
def project_gantt(project_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    require_member(db, project_id, user)
    tasks = db.query(Task).filter_by(project_id=project_id).order_by(Task.id).all()
    ids = {t.id for t in tasks}
    edges = db.query(TaskDependency).filter(TaskDependency.task_id.in_(ids)).all() if ids else []
    return {"tasks": [task_out(t, db).model_dump(mode="json") for t in tasks],
            "dependencies": [{"task_id": e.task_id, "depends_on_id": e.depends_on_id} for e in edges]}


@app.post("/tasks/{task_id}/dependencies", status_code=201)
def add_dependency(task_id: int, data: DependencyInput, db: Session = Depends(get_db),
                   user: User = Depends(get_current_user)):
    task = require_task(db, task_id, user, edit_required=True)
    other = db.get(Task, data.depends_on_id)
    if not other or other.project_id != task.project_id:
        raise HTTPException(400, "La dependència ha de ser una tasca del mateix projecte")
    if task.id == other.id or has_dependency_path(db, other.id, task.id):
        raise HTTPException(400, "La dependència produiria un cicle")
    existing = db.get(TaskDependency, (task.id, other.id))
    if existing:
        raise HTTPException(409, "Dependència existent")
    db.add(TaskDependency(task_id=task.id, depends_on_id=other.id))
    log_activity(db, task.project_id, user.id, "dependency_added", f"Dependència: {task.title} després de {other.title}", task.id)
    db.commit()
    return {"task_id": task.id, "depends_on_id": other.id}


@app.delete("/tasks/{task_id}/dependencies/{depends_on_id}")
def remove_dependency(task_id: int, depends_on_id: int, db: Session = Depends(get_db),
                      user: User = Depends(get_current_user)):
    task = require_task(db, task_id, user, edit_required=True)
    edge = db.get(TaskDependency, (task_id, depends_on_id))
    if not edge:
        raise HTTPException(404, "Dependència no trobada")
    db.delete(edge)
    log_activity(db, task.project_id, user.id, "dependency_removed", "Dependència eliminada", task.id)
    db.commit()
    return {"message": "Dependència eliminada"}


@app.get("/projects/{project_id}/activity")
def get_activity(project_id: int, limit: int = Query(default=100, ge=1, le=300),
                 db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    require_member(db, project_id, user)
    rows = db.query(ActivityLog).filter_by(project_id=project_id).order_by(
        ActivityLog.created_at.desc(), ActivityLog.id.desc()).limit(limit).all()
    return [{"id": a.id, "action": a.action, "description": a.description,
             "task_id": a.task_id, "user_name": (db.get(User, a.user_id).name if a.user_id and db.get(User, a.user_id) else "Usuari eliminat"),
             "created_at": a.created_at.isoformat()} for a in rows]


def next_occurrence(day, frequency):
    if frequency == "daily":
        return day + timedelta(days=1)
    if frequency == "weekly":
        return day + timedelta(days=7)
    year = day.year + (day.month // 12)
    month = (day.month % 12) + 1
    return date(year, month, min(day.day, monthrange(year, month)[1]))


def process_due_rules(db, today=None):
    today = today or datetime.now(timezone.utc).date()
    rules = db.query(RecurrenceRule).filter(RecurrenceRule.enabled.is_(True),
                                            RecurrenceRule.next_run <= today).all()
    created = 0
    for rule in rules:
        # Una execució només crea una ocurrència; s'evita crear milers de tasques
        # de cop després d'un període prolongat sense iniciar el servidor.
        scheduled = rule.next_run
        if db.query(RecurrenceRun).filter_by(rule_id=rule.id, scheduled_for=scheduled).first():
            rule.next_run = next_occurrence(scheduled, rule.frequency)
            db.commit()
            continue
        member = db.query(ProjectMember).filter_by(project_id=rule.project_id, user_id=rule.assignee_id).first() if rule.assignee_id else None
        task = Task(title=rule.title, project_id=rule.project_id, priority=rule.priority,
                    status="pendent", due_date=scheduled, assignee_id=rule.assignee_id if member else None)
        db.add(task)
        db.flush()
        db.add(RecurrenceRun(rule_id=rule.id, scheduled_for=scheduled, task_id=task.id))
        log_activity(db, rule.project_id, rule.created_by, "recurrence_created", f"Tasca recurrent creada: {rule.title}", task.id)
        rule.next_run = next_occurrence(scheduled, rule.frequency)
        db.commit()
        created += 1
    return created


@app.get("/projects/{project_id}/automations")
def list_automations(project_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    require_member(db, project_id, user)
    rules = db.query(RecurrenceRule).filter_by(project_id=project_id).order_by(RecurrenceRule.id.desc()).all()
    return [{"id": r.id, "title": r.title, "frequency": r.frequency, "next_run": r.next_run.isoformat(),
             "priority": r.priority, "assignee_id": r.assignee_id, "enabled": r.enabled} for r in rules]


@app.post("/projects/{project_id}/automations", status_code=201)
def create_automation(project_id: int, data: RecurrenceInput, db: Session = Depends(get_db),
                      user: User = Depends(get_current_user)):
    require_member(db, project_id, user, edit_required=True)
    verify_assignee(db, project_id, data.assignee_id)
    title = data.title.strip()
    if not title:
        raise HTTPException(400, "El títol no pot estar buit")
    rule = RecurrenceRule(project_id=project_id, created_by=user.id, title=title,
                          frequency=data.frequency, next_run=data.next_run,
                          priority=data.priority, assignee_id=data.assignee_id)
    db.add(rule)
    log_activity(db, project_id, user.id, "automation_created", f"Regla recurrent: {title}")
    db.commit()
    db.refresh(rule)
    return {"id": rule.id}


@app.patch("/projects/{project_id}/automations/{rule_id}")
def toggle_automation(project_id: int, rule_id: int, data: RecurrencePatch,
                      db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    require_member(db, project_id, user, edit_required=True)
    rule = db.query(RecurrenceRule).filter_by(project_id=project_id, id=rule_id).first()
    if not rule:
        raise HTTPException(404, "Regla no trobada")
    rule.enabled = data.enabled
    log_activity(db, project_id, user.id, "automation_updated", f"Regla {rule.title}: {'activa' if rule.enabled else 'pausada'}")
    db.commit()
    return {"id": rule.id, "enabled": rule.enabled}


@app.delete("/projects/{project_id}/automations/{rule_id}")
def remove_automation(project_id: int, rule_id: int, db: Session = Depends(get_db),
                      user: User = Depends(get_current_user)):
    require_member(db, project_id, user, edit_required=True)
    rule = db.query(RecurrenceRule).filter_by(project_id=project_id, id=rule_id).first()
    if not rule:
        raise HTTPException(404, "Regla no trobada")
    log_activity(db, project_id, user.id, "automation_deleted", f"Regla eliminada: {rule.title}")
    db.delete(rule)
    db.commit()
    return {"message": "Regla eliminada"}


@app.post("/automations/run-now")
def run_automations(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    # Executar totes les regles globals requeriria permisos addicionals; limitat
    # a les regles dels projectes on és propietari l'usuari.
    own_projects = {p.id for p, m in db.query(Project, ProjectMember).join(
        ProjectMember, ProjectMember.project_id == Project.id).filter(
        ProjectMember.user_id == user.id, ProjectMember.role == "owner").all()}
    today = datetime.now(timezone.utc).date()
    count = 0
    for rule in db.query(RecurrenceRule).filter(RecurrenceRule.project_id.in_(own_projects),
                                                RecurrenceRule.enabled.is_(True), RecurrenceRule.next_run <= today).all():
        if db.query(RecurrenceRun).filter_by(rule_id=rule.id, scheduled_for=rule.next_run).first():
            rule.next_run = next_occurrence(rule.next_run, rule.frequency)
            db.commit()
            continue
        member = db.query(ProjectMember).filter_by(project_id=rule.project_id, user_id=rule.assignee_id).first() if rule.assignee_id else None
        task = Task(title=rule.title, project_id=rule.project_id, due_date=rule.next_run,
                    priority=rule.priority, assignee_id=rule.assignee_id if member else None)
        db.add(task); db.flush()
        db.add(RecurrenceRun(rule_id=rule.id, scheduled_for=rule.next_run, task_id=task.id))
        log_activity(db, rule.project_id, user.id, "recurrence_created", f"Tasca recurrent creada: {rule.title}", task.id)
        rule.next_run = next_occurrence(rule.next_run, rule.frequency)
        db.commit(); count += 1
    return {"created": count}


@app.get("/search/global")
def global_search(q: str = Query(min_length=2, max_length=100),
                  limit: int = Query(default=40, ge=1, le=100),
                  db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    member_project_ids = [p[0] for p in db.query(ProjectMember.project_id).filter_by(user_id=user.id).all()]
    term = f"%{q.replace('%', r'\%').replace('_', r'\_')}%"
    projects = db.query(Project).filter(Project.id.in_(member_project_ids), Project.name.ilike(term, escape='\\')).limit(limit).all()
    tasks = db.query(Task).filter(Task.project_id.in_(member_project_ids),
                                   (Task.title.ilike(term, escape='\\') | Task.description.ilike(term, escape='\\'))).limit(limit).all()
    comments = db.query(TaskComment, Task).join(Task, Task.id == TaskComment.task_id).filter(
        Task.project_id.in_(member_project_ids), TaskComment.content.ilike(term, escape='\\')).limit(limit).all()
    return {"projects": [{"id": p.id, "name": p.name} for p in projects],
            "tasks": [{"id": t.id, "project_id": t.project_id, "title": t.title, "status": t.status} for t in tasks],
            "comments": [{"id": c.id, "task_id": t.id, "project_id": t.project_id,
                           "preview": c.content[:180]} for c, t in comments]}


def ai_provider() -> str:
    return os.getenv("AI_PROVIDER", "openai").strip().lower()


def ollama_base_url() -> str:
    # URL interna de Docker Desktop per arribar a Ollama instal·lat a Windows.
    # No acceptem una URL arbitrària rebuda de les peticions dels usuaris.
    return os.getenv("OLLAMA_BASE_URL", "http://host.docker.internal:11434").rstrip("/")


def call_ai(prompt: str):
    provider = ai_provider()
    system_message = (
        "Ets un assistent de gestió de projectes. Respon en català, de forma "
        "concisa, sense inventar dades. Qualsevol proposta s'ha de validar per l'usuari."
    )
    messages = [
        {"role": "system", "content": system_message},
        {"role": "user", "content": prompt},
    ]

    if provider == "ollama":
        url = ollama_base_url() + "/api/chat"
        payload = {
            "model": os.getenv("AI_MODEL", "llama3.2:3b"),
            "messages": messages,
            "stream": False,
            "options": {"num_predict": 600},
        }
        headers = {"Content-Type": "application/json"}
    elif provider == "openai":
        key = os.getenv("AI_API_KEY", "").strip()
        if not key:
            raise HTTPException(503, "Assistent IA no configurat. Defineix AI_API_KEY al servidor.")
        base = os.getenv("AI_BASE_URL", "https://api.openai.com/v1").rstrip("/")
        if not base.startswith("https://"):
            raise HTTPException(503, "AI_BASE_URL ha de ser HTTPS")
        url = base + "/chat/completions"
        payload = {
            "model": os.getenv("AI_MODEL", "gpt-4o-mini"),
            "messages": messages,
            "max_tokens": 600,
        }
        headers = {"Content-Type": "application/json", "Authorization": "Bearer " + key}
    else:
        raise HTTPException(503, "Proveïdor IA desconegut: configura AI_PROVIDER=ollama o openai")

    request = urllib.request.Request(
        url, data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        headers=headers, method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=120 if provider == "ollama" else 30) as response:
            result = json.loads(response.read(1024 * 1024))
        answer = (result["message"]["content"] if provider == "ollama"
                  else result["choices"][0]["message"]["content"])
        if not isinstance(answer, str) or not answer.strip():
            raise ValueError("Resposta buida")
        return answer.strip()
    except urllib.error.HTTPError as ex:
        raise HTTPException(502, f"El model IA ha retornat HTTP {ex.code}. Comprova el model i Ollama.") from ex
    except (urllib.error.URLError, KeyError, IndexError, ValueError, TimeoutError) as ex:
        raise HTTPException(502, "No es pot contactar amb la IA. Comprova que Ollama estigui actiu i el model instal·lat.") from ex


@app.get("/ai/status")
def ai_status(user: User = Depends(get_current_user)):
    provider = ai_provider()
    model = os.getenv("AI_MODEL", "llama3.2:3b" if provider == "ollama" else "gpt-4o-mini")
    if provider == "ollama":
        try:
            with urllib.request.urlopen(ollama_base_url() + "/api/tags", timeout=4) as response:
                tags = json.loads(response.read(256000))
            available = any(item.get("name") == model or item.get("model") == model
                            for item in tags.get("models", []))
            return {"configured": available, "provider": provider, "model": model}
        except (urllib.error.URLError, ValueError, TimeoutError):
            return {"configured": False, "provider": provider, "model": model}
    return {"configured": provider == "openai" and bool(os.getenv("AI_API_KEY", "").strip()),
            "provider": provider, "model": model}


@app.post("/projects/{project_id}/ai")
def project_ai(project_id: int, data: AIInput, db: Session = Depends(get_db),
               user: User = Depends(get_current_user)):
    require_member(db, project_id, user)
    project = db.get(Project, project_id)
    tasks = db.query(Task).filter_by(project_id=project_id).order_by(Task.id).limit(100).all()
    # No s'envien comentaris, adjunts ni dades personals al proveïdor d'IA.
    context = [{"title": t.title[:100], "status": t.status,
                "priority": t.priority, "due_date": t.due_date.isoformat() if t.due_date else None} for t in tasks]
    instruction = {"suggest_subtasks": "Proposa subtasques accionables.",
                   "summarize_project": "Resumeix progrés, pendents i prioritats.",
                   "risk_review": "Detecta riscos de retards i dependències possibles."}[data.action]
    answer = call_ai(f"Projecte: {project.name[:150]}\nEstat actual (màx. 100 tasques): {json.dumps(context, ensure_ascii=False)}\nAcció: {instruction}\nPetició: {data.prompt}")
    return {"answer": answer, "action": data.action, "generated_only": True}


# El bucle de recurrència s'activa quan s'inicia l'app i es cancel·la en sortir.
# No utilitza un segon contenidor ni un scheduler extern.
async def recurring_worker():
    while True:
        try:
            with SessionLocal() as db:
                await asyncio.to_thread(process_due_rules, db)
        except Exception as ex:
            print(f"TaskFlow recurrence worker error: {type(ex).__name__}", flush=True)
        await asyncio.sleep(60)


@asynccontextmanager
async def lifespan_30(application: FastAPI):
    Base.metadata.create_all(bind=engine)
    worker = asyncio.create_task(recurring_worker())
    try:
        yield
    finally:
        worker.cancel()
        try:
            await worker
        except asyncio.CancelledError:
            pass

app.router.lifespan_context = lifespan_30
