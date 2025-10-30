# core/models.py
from django.db import models
from django.contrib.auth.models import AbstractUser, UserManager as DjangoUserManager


class CustomUserManager(DjangoUserManager):
    def create_user(self, username, email=None, password=None, **extra_fields):
        extra_fields.setdefault('approval_status', self.model.ApprovalStatus.PENDING)
        return super().create_user(username, email=email, password=password, **extra_fields)

    def create_superuser(self, username, email=None, password=None, **extra_fields):
        extra_fields.setdefault('role', self.model.Role.ADMIN)
        extra_fields.setdefault('approval_status', self.model.ApprovalStatus.APPROVED)
        extra_fields.setdefault('is_staff', True)
        extra_fields.setdefault('is_superuser', True)
        if extra_fields.get('is_staff') is not True:
            raise ValueError('Superuser must have is_staff=True.')
        if extra_fields.get('is_superuser') is not True:
            raise ValueError('Superuser must have is_superuser=True.')
        return super().create_superuser(username, email=email, password=password, **extra_fields)


class User(AbstractUser):
    class Role(models.TextChoices):
        ADMIN = 'admin', 'Admin'
        STATIONERY = 'stationery', 'Stationery Maintainer'

    role = models.CharField(max_length=32, choices=Role.choices, default=Role.STATIONERY)
    class ApprovalStatus(models.TextChoices):
        PENDING = 'pending', 'Pending'
        APPROVED = 'approved', 'Approved'
        REJECTED = 'rejected', 'Rejected'

    approval_status = models.CharField(max_length=20, choices=ApprovalStatus.choices, default=ApprovalStatus.PENDING)
    objects = CustomUserManager()

class Department(models.Model):
    course_code = models.CharField(max_length=10)
    course = models.CharField(max_length=100)
    academic_year = models.CharField(max_length=20, blank=True, null=True, help_text="Format: YYYY-YYYY")
    program_type = models.CharField(max_length=50, blank=True, null=True)
    year = models.CharField(max_length=10, blank=True, null=True)
    
    # Numerical fields set to allow null/empty input from forms
    intake = models.PositiveIntegerField(default=0, blank=True, null=True)
    existing = models.PositiveIntegerField(default=0, blank=True, null=True)
    
    two_hundred_notebook = models.PositiveIntegerField(default=0, blank=True, null=True)
    two_hundred_record = models.PositiveIntegerField(default=0, blank=True, null=True)
    two_hundred_observation = models.PositiveIntegerField(default=0, blank=True, null=True)
    
    one_hundred_notebook = models.PositiveIntegerField(default=0, blank=True, null=True)
    one_hundred_record = models.PositiveIntegerField(default=0, blank=True, null=True)
    one_hundred_observation = models.PositiveIntegerField(default=0, blank=True, null=True)
    
    total = models.PositiveIntegerField(default=0, blank=True, null=True)

    class Meta:
        unique_together = ('course_code', 'year', 'academic_year')

    def __str__(self):
        return f"{self.course_code} - {self.course} ({self.year})"

class Student(models.Model):
    # Fixed: Removed primary_key=True from USN; Django uses the default 'id' field as PK
    usn = models.CharField(max_length=20, unique=True)
    name = models.CharField(max_length=100)
    department = models.ForeignKey(Department, on_delete=models.CASCADE, related_name='dept_students') 
    year = models.CharField(max_length=10, blank=True, null=True)
    email = models.EmailField(max_length=254, blank=True, null=True)
    phone = models.CharField(max_length=15, blank=True, null=True)

    def __str__(self):
        return f"{self.usn} - {self.name}"

class Item(models.Model):
    item_code = models.CharField(max_length=10, unique=True)
    name = models.CharField(max_length=100)
    quantity = models.IntegerField(default=0)

    def __str__(self):
        return f"{self.name} ({self.item_code})"

# Dynamic per-department item requirements (non-breaking alongside legacy fields)
class DepartmentItemRequirement(models.Model):
    department = models.ForeignKey(Department, on_delete=models.CASCADE, related_name='item_requirements')
    item = models.ForeignKey(Item, on_delete=models.CASCADE, related_name='department_requirements')
    required_qty = models.PositiveIntegerField(default=0)

    class Meta:
        unique_together = ('department', 'item')

    def __str__(self):
        return f"Req: {self.department.course_code}/{self.department.course} ({self.department.academic_year} Y{self.department.year}) - {self.item.item_code} = {self.required_qty}"

class IssueRecord(models.Model):
    student = models.ForeignKey(Student, on_delete=models.CASCADE, related_name='issue_records')
    item_code = models.CharField(max_length=10)
    qty_issued = models.IntegerField()
    date_issued = models.DateField(auto_now_add=True)
    status = models.CharField(max_length=20, default='Issued') 
    remarks = models.CharField(max_length=255, blank=True, null=True) 
    # Cohort info so issues are isolated per Academic Year and Year
    academic_year = models.CharField(max_length=20, blank=True, null=True)
    year = models.CharField(max_length=10, blank=True, null=True)

    def __str__(self):
        return f"Issued {self.qty_issued} of {self.item_code} to {self.student.usn}"

# core/models.py
class PendingReport(models.Model):
    student = models.ForeignKey(Student, on_delete=models.CASCADE, related_name='pending_reports')
    usn = models.CharField(max_length=20)
    name = models.CharField(max_length=100)
    course = models.CharField(max_length=100)
    course_code = models.CharField(max_length=10, blank=True, null=True)
    academic_year = models.CharField(max_length=20, blank=True, null=True)  # <- add blank=True, null=True
    year = models.CharField(max_length=10, blank=True, null=True)          # <- add blank=True, null=True
    # qty fields unchanged...

    # Fields map to item codes as used by frontend
    pn2 = models.IntegerField(default=0)
    pr2 = models.IntegerField(default=0)
    po2 = models.IntegerField(default=0)
    pn1 = models.IntegerField(default=0)
    pr1 = models.IntegerField(default=0)
    po1 = models.IntegerField(default=0)

    class Meta:
        unique_together = ('student', 'academic_year', 'year')

    def __str__(self):
        return f"Pending Report for {self.usn} ({self.academic_year} Y{self.year})"

class Enrollment(models.Model):
    student = models.ForeignKey(Student, on_delete=models.CASCADE, related_name='enrollments')
    department = models.ForeignKey(Department, on_delete=models.CASCADE, related_name='enrollments')
    academic_year = models.CharField(max_length=20)
    year = models.CharField(max_length=10)

    class Meta:
        unique_together = ('student', 'department', 'academic_year', 'year')

    def __str__(self):
        return f"Enrollment: {self.student.usn} - {self.department.course_code}/{self.department.course} ({self.academic_year} Y{self.year})"

class ActivityLog(models.Model):
    ACTION_CHOICES = [
        ('department_added', 'Department Added'),
        ('department_edited', 'Department Edited'),
        ('department_deleted', 'Department Deleted'),
        ('student_added', 'Student Added'),
        ('student_edited', 'Student Edited'),
        ('student_deleted', 'Student Deleted'),
        ('bulk_upload', 'Bulk Upload'),
        ('books_issued', 'Books Issued'),
        ('report_generated', 'Report Generated'),
        ('pending_generated', 'Pending Report Generated'),
    ]
    
    action = models.CharField(max_length=50, choices=ACTION_CHOICES)
    description = models.TextField()
    timestamp = models.DateTimeField(auto_now_add=True)
    user = models.CharField(max_length=100, blank=True, null=True)
    
    class Meta:
        ordering = ['-timestamp']
    
    def __str__(self):
        return f"{self.action} - {self.timestamp}"


class HelpThread(models.Model):
    user = models.OneToOneField(User, on_delete=models.CASCADE, related_name='help_thread')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"Help Thread for {self.user.username}"


class HelpMessage(models.Model):
    thread = models.ForeignKey(HelpThread, on_delete=models.CASCADE, related_name='messages')
    sender = models.ForeignKey(User, on_delete=models.CASCADE, related_name='sent_help_messages')
    content = models.TextField(blank=True)
    attachment = models.FileField(upload_to='help_center/', blank=True, null=True)
    attachment_type = models.CharField(max_length=20, blank=True, null=True)
    created_at = models.DateTimeField(auto_now_add=True)
    is_admin_read = models.BooleanField(default=False)
    is_user_read = models.BooleanField(default=False)
    is_admin_deleted = models.BooleanField(default=False)
    is_user_deleted = models.BooleanField(default=False)

    class Meta:
        ordering = ['created_at']

    def __str__(self):
        return f"Message from {self.sender.username} at {self.created_at}"


class Notification(models.Model):
    recipient = models.ForeignKey(User, on_delete=models.CASCADE, related_name='notifications')
    message = models.CharField(max_length=255)
    link = models.CharField(max_length=255, blank=True, null=True)
    notification_type = models.CharField(max_length=50, blank=True, null=True)
    is_read = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f"Notification for {self.recipient.username}: {self.message[:30]}"


class InventoryOrder(models.Model):
    class Status(models.TextChoices):
        PENDING = 'pending', 'Pending'
        PARTIAL = 'partial', 'Partial'
        RECEIVED = 'received', 'Received'

    item = models.ForeignKey(Item, on_delete=models.CASCADE, related_name='inventory_orders')
    ordered_qty = models.PositiveIntegerField()
    received_qty = models.PositiveIntegerField(default=0)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.PENDING)
    reference = models.CharField(max_length=120, blank=True, null=True)
    ordered_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    ordered_by = models.ForeignKey(User, on_delete=models.SET_NULL, related_name='orders_created', blank=True, null=True)

    class Meta:
        ordering = ['-ordered_at']

    @property
    def pending_qty(self):
        return max(0, self.ordered_qty - self.received_qty)

    def refresh_status(self):
        if self.received_qty <= 0:
            self.status = self.Status.PENDING
        elif self.received_qty < self.ordered_qty:
            self.status = self.Status.PARTIAL
        else:
            self.status = self.Status.RECEIVED

    def __str__(self):
        return f"Order #{self.id} for {self.item.item_code} ({self.status})"


class InventoryReceipt(models.Model):
    order = models.ForeignKey(InventoryOrder, on_delete=models.SET_NULL, related_name='receipts', blank=True, null=True)
    item = models.ForeignKey(Item, on_delete=models.CASCADE, related_name='inventory_receipts')
    quantity = models.PositiveIntegerField()
    consumed_qty = models.PositiveIntegerField(default=0)
    note = models.CharField(max_length=255, blank=True, null=True)
    received_at = models.DateTimeField(auto_now_add=True)
    received_by = models.ForeignKey(User, on_delete=models.SET_NULL, related_name='inventory_receipts', blank=True, null=True)

    class Meta:
        ordering = ['-received_at']

    @property
    def available_qty(self):
        return max(0, self.quantity - self.consumed_qty)

    def __str__(self):
        return f"Receipt {self.quantity} x {self.item.item_code}"


class StockLogEntry(models.Model):
    item = models.ForeignKey(Item, on_delete=models.CASCADE, related_name='stock_logs')
    change = models.IntegerField()
    reason = models.CharField(max_length=255, blank=True, null=True)
    previous_quantity = models.IntegerField(default=0)
    new_quantity = models.IntegerField(default=0)
    pending_delta = models.IntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    created_by = models.ForeignKey(User, on_delete=models.SET_NULL, related_name='stock_logs', blank=True, null=True)
    order = models.ForeignKey(InventoryOrder, on_delete=models.SET_NULL, related_name='stock_logs', blank=True, null=True)
    receipt = models.ForeignKey(InventoryReceipt, on_delete=models.SET_NULL, related_name='stock_logs', blank=True, null=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f"Stock change {self.change} for {self.item.item_code}"